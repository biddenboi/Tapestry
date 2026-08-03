import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';
import { GAME_STATE, MINUTE, STORES } from '@domain/constants.js';
import NiceModal from '@ebay/nice-modal-react';
import { loadTaskCreationMenu, loadTaskPreviewMenu } from '@features/tasks/loaders.js';
import { createTaskDraft, getCanonicalTaskPoints } from '@domain/tasks/Tasks.js';
import { useInterval } from '@shared/hooks/useInterval.js';
import {
    clampDojoFeedIndex,
    clampDojoFeedScrollTop,
    createDojoVisibilityTracker,
    dojoFeedIndexFromScroll,
    isAtDojoFeedEnd,
    shouldRequestDojoRecommendation,
} from '@features/matches/components/PracticeDojo/dojoFeedPolicy.js';

let taskRecommenderModulePromise = null;
const loadTaskRecommender = () => {
    if (!taskRecommenderModulePromise) {
        taskRecommenderModulePromise = measureDynamicModule('task-recommender', () => import('@domain/tasks/TaskRecommender.js'))
            .catch((error) => {
                taskRecommenderModulePromise = null;
                throw error;
            });
    }
    return taskRecommenderModulePromise;
};

function withRecommendationTimeout(promise, timeoutMs = 15_000) {
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Recommendation scoring timed out.')), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function useSessionTimer(startMs) {
    const [elapsed, setElapsed] = useState(startMs ? Date.now() - startMs : 0);
    useEffect(() => {
        setElapsed(startMs ? Date.now() - startMs : 0);
    }, [startMs]);
    useInterval(
        () => setElapsed(Date.now() - startMs),
        startMs ? 1000 : null,
    );
    return elapsed;
}

function isQueuedTodo(todo = {}) {
    const status = String(todo.status || todo.state || '').toLowerCase();
    return !['done', 'complete', 'completed', 'archived', 'deleted'].includes(status);
}

export function recommendationEvidenceLabel(recommendation) {
    return recommendation?.evidenceState === 'supported' ? 'personalized' : 'exploring';
}

function applyDojoRecommendationToTask(recommendation, event = null) {
    if (!recommendation?.task) return null;
    const reasonToSelect = `Suggested because: ${(recommendation.reasonChips || []).join(' · ') || recommendation.primaryReason}`;
    const suggestedMinutes = Math.max(1, Math.round(Number(
        recommendation.requiredTimerMinutes
        || recommendation.suggestedMinutes
        || recommendation.task.estimatedDuration
        || 25,
    )));
    return {
        ...recommendation.task,
        reasonToSelect,
        sessionDuration: suggestedMinutes * MINUTE,
        recommendation: {
            evidenceState: recommendation.evidenceState || 'neutral-exploration',
            primaryReason: recommendation.primaryReason,
            supportingReasons: recommendation.supportingReasons || [],
            expectedWorkloadImpact: recommendation.expectedWorkloadImpact,
            suggestedMinutes: recommendation.suggestedMinutes,
            requiredTimerMinutes: recommendation.requiredTimerMinutes || suggestedMinutes,
            mode: recommendation.mode,
            source: recommendation.source,
            selectedAt: new Date().toISOString(),
                  eventUUID: event?.UUID || null,
        },
        taskRecommendationEventId: event?.UUID || null,
        taskRecommendationSource: recommendation.source || 'dojo',
    };
}

function makeDojoFeedCard(recommendation, position = 0, event = null, ownerId = null) {
    if (!recommendation) return null;
    const todo = applyDojoRecommendationToTask(recommendation, event);
    if (!todo) return null;
    return {
        id: `${recommendation.actionKey || recommendation.task.UUID}:${position}:${uuid()}`,
        ownerId: ownerId || recommendation.task.parent || null,
        event,
        recommendation,
        todo,
        presented: Boolean(event?.presentation),
    };
}

function scheduleIdleTask(callback, { timeout = 3500, delay = 900 } = {}) {
    if (typeof window === 'undefined') {
        callback();
        return null;
    }
    if ('requestIdleCallback' in window) {
        return { type: 'idle', id: window.requestIdleCallback(callback, { timeout }) };
    }
    return { type: 'timer', id: window.setTimeout(callback, delay) };
}

function cancelScheduledTask(token) {
    if (!token || typeof window === 'undefined') return;
    if (token.type === 'idle' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(token.id);
        return;
    }
    if (token.type === 'timer') window.clearTimeout(token.id);
}

export function dojoModelStateLabel(state) {
    if (state === 'scoring') return 'algorithm scoring one next task';
    if (state === 'ready') return 'next recommendation ready';
    if (state === 'resolving-feedback') return 'saving your response';
    if (state === 'paused') return 'no eligible task';
    if (state === 'empty') return 'no open tasks';
    if (state === 'error') return 'recommendation failed';
    return 'loading your tasks';
}

export function dojoBoundaryLabel(state) {
    if (state === 'scoring') return 'Scoring one next recommendation…';
    if (state === 'resolving-feedback') return 'Saving this response before scoring the next task…';
    if (state === 'paused') return 'No eligible task is currently available.';
    if (state === 'error') return 'The next score failed. Scroll past the end to retry.';
    return 'Scroll past the final task to generate the next recommendation.';
}

export default function usePracticeDojoController({ presentTask = null } = {}) {
    const {
        databaseConnection, domainRevisions, currentPlayer, dojoSessionUUID,
        gameState:   [, setGameState],
        activeTask:  [activeTask, setActiveTask],
        openPanel,
    } = useAppContext();

    const ownerId = currentPlayer?.UUID || null;
    const [sessionStart] = useState(() => Date.now());
    const [sessionPoints, setSessionPoints] = useState(0);
    const [todoCount, setTodoCount] = useState(0);
    const [recommendationFeed, setRecommendationFeed] = useState([]);
    const [generationState, setGenerationState] = useState('loading-source');
    const [sourceReady, setSourceReady] = useState(false);
    const [sourceRetry, setSourceRetry] = useState(0);
    const [requestCycle, setRequestCycle] = useState(0);
    const [, setActiveFeedIndex] = useState(0);
    const [taskHistory, setTaskHistory] = useState([]);

    const feedScrollerRef = useRef(null);
    const feedItemsRef = useRef([]);
    const dojoSourceRef = useRef({
        ownerId: null, todos: [], history: [], contextToken: null, ready: false,
    });
    const currentPlayerRef = useRef(currentPlayer);
    const sourceLoadTokenRef = useRef(0);
    const generationEpochRef = useRef(0);
    const modelRequestRef = useRef(null);
    const mountedRef = useRef(false);
    const scrollFrameRef = useRef(null);
    const pendingScrollContainerRef = useRef(null);
    const activeFeedIndexRef = useRef(0);
    const scrollSettleTimerRef = useRef(null);
    const boundaryWheelDeltaRef = useRef(0);
    const boundaryWheelResetTimerRef = useRef(null);
    const generatedRevealTimerRef = useRef(null);
    const boundaryNextAllowedAtRef = useRef(0);
    const boundaryTouchStartYRef = useRef(null);
    const boundaryTouchTriggeredRef = useRef(false);
    const launchingTaskRef = useRef(false);
    const advancingRecommendationRef = useRef(false);
    const skippedRecommendationEventsRef = useRef(new Set());
    const acceptedRecommendationEventsRef = useRef(new Set());
    const skipSignalQueueRef = useRef([]);
    const skipSignalFlushRef = useRef(null);
    const pendingSkipWritesRef = useRef(new Map());
    const warmSessionRef = useRef(null);
    const warmSessionPromiseRef = useRef(null);
    const visibilityTrackerRef = useRef(null);
    const visibilityObserverRef = useRef(null);
    const wasInTaskRef = useRef(Boolean(activeTask.createdAt));

    currentPlayerRef.current = currentPlayer;
    const elapsed = useSessionTimer(sessionStart);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        feedItemsRef.current = recommendationFeed;
    }, [recommendationFeed]);

    useEffect(() => {
        const tracker = createDojoVisibilityTracker({
            minimumVisibleRatio: 0.6,
            minimumVisibleMs: 500,
            onPresented: ({ visibleMs, minimumVisibleRatio, metadata }) => {
                const { item, index } = metadata || {};
                if (!item || item.presented) return;
                item.presented = true;
                warmSessionRef.current?.present(item, {
                    position: index,
                    visibleMs,
                    minimumVisibleRatio,
                }).catch((error) => (
                    console.warn('[PracticeDojo] visibility presentation failed:', error)
                ));
            },
            onVisibilitySegment: ({ segmentId, visibleStartedAtMs, visibleMs, metadata }) => {
                const item = metadata?.item;
                if (!item?.presented || !(visibleMs > 0)) return;
                warmSessionRef.current?.accumulateVisibility(item, {
                    segmentId,
                    visibleStartedAt: new Date(visibleStartedAtMs).toISOString(),
                    visibleMs,
                }).catch((error) => (
                    console.warn('[PracticeDojo] visibility accumulation failed:', error)
                ));
            },
        });
        visibilityTrackerRef.current = tracker;
        return () => {
            tracker.dispose();
            if (visibilityTrackerRef.current === tracker) visibilityTrackerRef.current = null;
        };
    }, [dojoSessionUUID, ownerId]);

    useEffect(() => {
        const inTask = Boolean(activeTask.createdAt);
        const sessionFinished = wasInTaskRef.current && !inTask;
        wasInTaskRef.current = inTask;
        if (!sessionFinished) return;
        const previousWarmSession = warmSessionRef.current;
        warmSessionRef.current = null;
        warmSessionPromiseRef.current = null;
        previousWarmSession?.close().catch((error) => (
            console.warn('[PracticeDojo] completed warm session close failed:', error)
        ));
        visibilityObserverRef.current?.disconnect();
        feedItemsRef.current.forEach((item) => visibilityTrackerRef.current?.discard(item.id));
        feedItemsRef.current = [];
        activeFeedIndexRef.current = 0;
        setRecommendationFeed([]);
        setActiveFeedIndex(0);
        setGenerationState(dojoSourceRef.current.todos.length ? 'ready' : 'empty');
    }, [activeTask.createdAt]);

    useEffect(() => {
        visibilityObserverRef.current?.disconnect();
        visibilityObserverRef.current = null;
        const scroller = feedScrollerRef.current;
        const tracker = visibilityTrackerRef.current;
        if (!scroller || !tracker || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const cardId = entry.target?.dataset?.cardId;
                const index = feedItemsRef.current.findIndex((item) => item.id === cardId);
                if (!cardId || index < 0) continue;
                tracker.observe(cardId, entry.intersectionRatio, {
                    item: feedItemsRef.current[index],
                    index,
                });
            }
        }, { root: scroller, threshold: [0, 0.6, 1] });
        scroller.querySelectorAll('[data-card-id]').forEach((element) => observer.observe(element));
        visibilityObserverRef.current = observer;
        return () => {
            observer.disconnect();
            if (visibilityObserverRef.current === observer) visibilityObserverRef.current = null;
        };
    }, [recommendationFeed]);

    const commitGenerationState = useCallback((nextState) => {
        if (!mountedRef.current) return;
        // This is small control state, not expensive presentation work. Making
        // it a transition can starve terminal states behind the one-second
        // session timer and leave mobile displaying "Preparing" indefinitely.
        setGenerationState(nextState);
    }, []);

    useEffect(() => {
        generationEpochRef.current += 1;
        sourceLoadTokenRef.current += 1;
        const previousWarmSession = warmSessionRef.current;
        warmSessionRef.current = null;
        warmSessionPromiseRef.current = null;
        previousWarmSession?.close().catch((error) => (
            console.warn('[PracticeDojo] warm session close failed:', error)
        ));
        dojoSourceRef.current = {
            ownerId, todos: [], history: [], contextToken: null, ready: false,
        };
        feedItemsRef.current = [];
        activeFeedIndexRef.current = 0;
        skippedRecommendationEventsRef.current = new Set();
        acceptedRecommendationEventsRef.current = new Set();
        skipSignalQueueRef.current = [];
        cancelScheduledTask(skipSignalFlushRef.current);
        skipSignalFlushRef.current = null;
        if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
        scrollSettleTimerRef.current = null;
        if (boundaryWheelResetTimerRef.current) window.clearTimeout(boundaryWheelResetTimerRef.current);
        boundaryWheelResetTimerRef.current = null;
        if (generatedRevealTimerRef.current) window.clearTimeout(generatedRevealTimerRef.current);
        generatedRevealTimerRef.current = null;
        boundaryNextAllowedAtRef.current = 0;
        boundaryWheelDeltaRef.current = 0;
        boundaryTouchStartYRef.current = null;
        boundaryTouchTriggeredRef.current = false;
        setRecommendationFeed([]);
        setActiveFeedIndex(0);
        setSourceReady(false);
        setTodoCount(0);
        setGenerationState(ownerId ? 'loading-source' : 'empty');
        if (feedScrollerRef.current) feedScrollerRef.current.scrollTop = 0;
    }, [dojoSessionUUID, ownerId]);

    useEffect(() => {
        let cancelled = false;
        const loadToken = ++sourceLoadTokenRef.current;

        const load = async () => {
            if (!ownerId) return;
            try {
                const [ownedHistory, playerTodos] = await Promise.all([
                    databaseConnection.getPlayerStore(STORES.task, ownerId),
                    databaseConnection.getAll(STORES.todo),
                ]);
                if (
                    cancelled
                    || loadToken !== sourceLoadTokenRef.current
                    || String(currentPlayerRef.current?.UUID || '') !== String(ownerId)
                ) return;

                const ownedTodos = (playerTodos || []).filter(isQueuedTodo);
                const eligibleById = new Map(ownedTodos.map((todo) => [String(todo.UUID), todo]));
                const contextToken = `${domainRevisions.tasks}:${ownedHistory.length}`;
                let sourceFeed = feedItemsRef.current;
                const stagedItem = sourceFeed.at(-1);
                const stagedLiveTask = stagedItem
                    ? eligibleById.get(String(stagedItem.recommendation?.task?.UUID || ''))
                    : null;
                if (stagedItem && !stagedLiveTask && warmSessionRef.current) {
                    if (stagedItem.presented) {
                        visibilityTrackerRef.current?.resolve(stagedItem.id);
                        await warmSessionRef.current.skip(
                            stagedItem,
                            'dojo-task-unavailable',
                        );
                    } else {
                        await warmSessionRef.current.invalidate(
                            stagedItem,
                            'dojo-task-unavailable-before-presentation',
                        );
                        visibilityTrackerRef.current?.discard(stagedItem.id);
                    }
                    sourceFeed = sourceFeed.filter((item) => item.id !== stagedItem.id);
                } else if (
                    stagedItem
                    && !stagedItem.presented
                    && warmSessionRef.current
                    && !warmSessionRef.current.sourceMatches(ownedTodos, {}, contextToken)
                ) {
                    await warmSessionRef.current.invalidate(
                        stagedItem,
                        'dojo-source-context-changed',
                    );
                    visibilityTrackerRef.current?.discard(stagedItem.id);
                    sourceFeed = sourceFeed.filter((item) => item.id !== stagedItem.id);
                }
                const reconciledFeed = sourceFeed
                    .map((item) => {
                        const liveTodo = eligibleById.get(String(item?.recommendation?.task?.UUID || ''));
                        if (!liveTodo) return null;
                        const recommendation = { ...item.recommendation, task: liveTodo };
                        const todo = applyDojoRecommendationToTask(recommendation, item.event);
                        return todo ? { ...item, ownerId, recommendation, todo } : null;
                    })
                    .filter(Boolean);

                dojoSourceRef.current = {
                    ownerId,
                    todos: ownedTodos,
                    history: ownedHistory,
                    contextToken,
                    ready: true,
                };
                feedItemsRef.current = reconciledFeed;
                const nextIndex = clampDojoFeedIndex(activeFeedIndexRef.current, reconciledFeed.length);
                activeFeedIndexRef.current = nextIndex;
                setRecommendationFeed(reconciledFeed);
                setActiveFeedIndex(nextIndex);
                setTodoCount(ownedTodos.length);
                setSourceReady(true);
                setGenerationState(
                    ownedTodos.length === 0
                        ? 'empty'
                        : modelRequestRef.current ? 'scoring' : 'ready',
                );

                const mine = ownedHistory.filter((task) => (
                    task.source === 'dojo' && task.dojoSessionUUID === dojoSessionUUID
                ));
                mine.sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
                setSessionPoints(mine.reduce((sum, task) => sum + getCanonicalTaskPoints(task), 0));
                setTaskHistory(mine.slice(0, 5));

            } catch (error) {
                if (cancelled || loadToken !== sourceLoadTokenRef.current) return;
                console.warn('[PracticeDojo] source load failed:', error);
                dojoSourceRef.current = {
                    ownerId, todos: [], history: [], contextToken: null, ready: false,
                };
                setSourceReady(false);
                setGenerationState('error');
            }
        };

        load();
        return () => { cancelled = true; };
    }, [
        databaseConnection,
        dojoSessionUUID,
        domainRevisions.tasks,
        ownerId,
        sourceRetry,
    ]);

    const requestOneRecommendation = useCallback((force = false) => {
        const source = dojoSourceRef.current;
        const player = currentPlayerRef.current;
        if (
            !source.ready
            || !source.ownerId
            || !player?.UUID
            || String(player.UUID) !== String(source.ownerId)
            || modelRequestRef.current
        ) return false;
        if (!source.todos.length) {
            commitGenerationState('empty');
            return false;
        }

        const request = {
            id: uuid(),
            ownerId: source.ownerId,
            epoch: generationEpochRef.current,
            force,
        };
        modelRequestRef.current = request;
        commitGenerationState('scoring');
        let completedState = 'ready';

        const isCurrentRequest = () => (
            mountedRef.current
            && modelRequestRef.current === request
            && generationEpochRef.current === request.epoch
            && String(currentPlayerRef.current?.UUID || '') === String(request.ownerId)
            && String(dojoSourceRef.current.ownerId || '') === String(request.ownerId)
        );

        const scoringPromise = loadTaskRecommender()
            .then(async ({ createTaskRecommenderWarmSession }) => {
                if (!warmSessionPromiseRef.current) {
                    warmSessionPromiseRef.current = createTaskRecommenderWarmSession({
                        databaseConnection,
                        currentPlayer: player,
                        source: 'dojo',
                        observationSessionUUID: dojoSessionUUID,
                    }).then((session) => {
                        warmSessionRef.current = session;
                        return session;
                    }).catch((error) => {
                        warmSessionPromiseRef.current = null;
                        throw error;
                    });
                }
                const warmSession = await warmSessionPromiseRef.current;
                return warmSession?.stage({
                    todos: source.todos,
                    mode: 'normal',
                    contextToken: source.contextToken,
                });
            });

        request.promise = withRecommendationTimeout(scoringPromise)
            .then(async (stagedRecommendation) => {
                if (!isCurrentRequest()) return;
                if (!stagedRecommendation?.recommendation) {
                    completedState = 'paused';
                    return;
                }
                const { recommendation, event } = stagedRecommendation;

                // A same-player database refresh may finish while scoring is in
                // flight. Keep the score, but reconcile its task against the
                // newest source snapshot before appending it.
                const latestSource = dojoSourceRef.current;
                if (!warmSessionRef.current?.sourceMatches(
                    latestSource.todos,
                    {},
                    latestSource.contextToken,
                )) {
                    await warmSessionRef.current?.invalidate(
                        stagedRecommendation,
                        'dojo-source-changed-during-scoring',
                    );
                    completedState = latestSource.todos.length > 0 ? 'ready' : 'empty';
                    return;
                }
                const liveTask = latestSource.todos.find((todo) => (
                    String(todo?.UUID || '') === String(recommendation?.task?.UUID || '')
                    && isQueuedTodo(todo)
                ));
                if (!liveTask) {
                    await warmSessionRef.current?.invalidate(
                        stagedRecommendation,
                        'dojo-task-unavailable-before-presentation',
                    );
                    completedState = latestSource.todos.length > 0 ? 'ready' : 'empty';
                    return;
                }
                const liveRecommendation = { ...recommendation, task: liveTask };

                const card = makeDojoFeedCard(
                    liveRecommendation,
                    feedItemsRef.current.length,
                    event,
                    request.ownerId,
                );
                if (!card) {
                    completedState = 'error';
                    return;
                }
                const next = [...feedItemsRef.current, card];
                feedItemsRef.current = next;
                setRecommendationFeed(next);
                completedState = 'ready';
                const nextIndex = next.length - 1;
                const scrollToAppendedCard = (attempt = 0) => {
                    requestAnimationFrame(() => {
                        const scroller = feedScrollerRef.current;
                        if (!scroller?.isConnected) return;
                        const appendedCard = scroller.querySelector(`[data-feed-index="${nextIndex}"]`);
                        if (!appendedCard && attempt < 12) {
                            scrollToAppendedCard(attempt + 1);
                            return;
                        }
                        const reveal = () => {
                            generatedRevealTimerRef.current = null;
                            if (!scroller.isConnected) return;
                            activeFeedIndexRef.current = nextIndex;
                            setActiveFeedIndex(nextIndex);
                            scroller.scrollTo({
                                top: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
                                behavior: 'smooth',
                            });
                        };
                        if (nextIndex === 0) reveal();
                        else generatedRevealTimerRef.current = window.setTimeout(reveal, 280);
                    });
                };
                scrollToAppendedCard();
            })
            .catch((error) => {
                if (!isCurrentRequest()) return;
                completedState = 'error';
                console.warn('[PracticeDojo] algorithm recommendation failed:', error);
            })
            .finally(() => {
                const requestWasCurrent = isCurrentRequest();
                if (modelRequestRef.current === request) modelRequestRef.current = null;
                if (requestWasCurrent && mountedRef.current) commitGenerationState(completedState);
                if (mountedRef.current) setRequestCycle((cycle) => cycle + 1);
            });
        return true;
    }, [commitGenerationState, databaseConnection, dojoSessionUUID]);

    useEffect(() => {
        if (activeTask.createdAt) return;
        const shouldRequest = shouldRequestDojoRecommendation({
            cardCount: recommendationFeed.length,
            sourceReady,
            requestInFlight: !!modelRequestRef.current,
            failed: generationState === 'error' || generationState === 'paused',
        });
        if (shouldRequest) requestOneRecommendation();
    }, [
        activeTask.createdAt,
        generationState,
        recommendationFeed.length,
        requestCycle,
        requestOneRecommendation,
        sourceReady,
    ]);

    useEffect(() => {
        if (
            activeTask.createdAt
            || !sourceReady
            || recommendationFeed.length > 0
            || generationState === 'error'
            || generationState === 'paused'
            || generationState === 'empty'
        ) return undefined;

        // Profile/bootstrap state and the shared task source can settle in the
        // same render. Retry once after that commit so a transient owner-ref
        // mismatch cannot strand an otherwise eligible queue in `ready`.
        const kickoff = window.setTimeout(() => {
            if (feedItemsRef.current.length > 0 || modelRequestRef.current || activeTask.createdAt) return;
            const started = requestOneRecommendation(true);
            if (!started && !modelRequestRef.current) commitGenerationState('error');
        }, 300);
        return () => window.clearTimeout(kickoff);
    }, [
        activeTask.createdAt,
        commitGenerationState,
        generationState,
        recommendationFeed.length,
        requestOneRecommendation,
        sourceReady,
    ]);

    const persistRecommendationSkip = useCallback((item, reason = 'dojo-scroll-skip', options = {}) => {
        const signalOwnerId = item?.ownerId || item?.recommendation?.task?.parent || null;
        const signalKey = item?.event?.UUID || item?.id;
        if (!signalOwnerId || !signalKey || !item?.recommendation || !item.presented) {
            return Promise.resolve(null);
        }
        if (acceptedRecommendationEventsRef.current.has(signalKey)) return Promise.resolve(item.event || null);
        const existingWrite = pendingSkipWritesRef.current.get(signalKey);
        if (existingWrite) return existingWrite;

        const suggestedMinutes = Number(
            options.suggestedMinutes
            ?? item?.todo?.recommendation?.suggestedMinutes
            ?? item?.todo?.estimatedDuration
            ?? 0,
        );
        const write = Promise.resolve().then(async () => {
                if (!item.event?.UUID || acceptedRecommendationEventsRef.current.has(signalKey)) {
                    return item.event || null;
                }
                skippedRecommendationEventsRef.current.add(signalKey);
                skippedRecommendationEventsRef.current.add(item.event.UUID);
                visibilityTrackerRef.current?.resolve(item.id);
                const result = await warmSessionRef.current?.skip(item, reason, {
                    reason,
                    suggestedMinutes,
                });
                return result || item.event;
            })
            .finally(() => pendingSkipWritesRef.current.delete(signalKey));
        pendingSkipWritesRef.current.set(signalKey, write);
        return write;
    }, []);

    const flushNextSkipSignal = useCallback(() => {
        skipSignalFlushRef.current = null;
        const payload = skipSignalQueueRef.current.shift();
        if (!payload) return;
        const { item, reason, suggestedMinutes } = payload;
        persistRecommendationSkip(item, reason, { suggestedMinutes })
            .catch((error) => console.warn('[PracticeDojo] recommendation skip signal failed:', error))
            .finally(() => {
                if (mountedRef.current && skipSignalQueueRef.current.length > 0) {
                    skipSignalFlushRef.current = scheduleIdleTask(flushNextSkipSignal);
                }
            });
    }, [persistRecommendationSkip]);

    const scheduleSkipSignalFlush = useCallback(() => {
        if (skipSignalFlushRef.current || skipSignalQueueRef.current.length === 0) return;
        skipSignalFlushRef.current = scheduleIdleTask(flushNextSkipSignal);
    }, [flushNextSkipSignal]);

    const markRecommendationSkipped = useCallback((item, reason = 'dojo-scroll-skip') => {
        const signalKey = item?.event?.UUID || item?.id;
        const signalOwnerId = item?.ownerId || item?.recommendation?.task?.parent || null;
        if (!signalKey || !signalOwnerId || !item?.recommendation) return;
        if (!item.presented) return;
        if (
            acceptedRecommendationEventsRef.current.has(signalKey)
            || skippedRecommendationEventsRef.current.has(signalKey)
        ) return;
        skippedRecommendationEventsRef.current.add(signalKey);
        if (skipSignalQueueRef.current.length >= 12) skipSignalQueueRef.current.shift();
        skipSignalQueueRef.current.push({
            item,
            ownerId: signalOwnerId,
            reason,
            suggestedMinutes: Number(item?.todo?.recommendation?.suggestedMinutes || item?.todo?.estimatedDuration || 0),
        });
        scheduleSkipSignalFlush();
    }, [scheduleSkipSignalFlush]);

    const handleAdvanceRecommendation = useCallback(async () => {
        if (advancingRecommendationRef.current || modelRequestRef.current || activeTask.createdAt) return;
        const currentItem = feedItemsRef.current[feedItemsRef.current.length - 1];
        if (!currentItem) {
            requestOneRecommendation(true);
            return;
        }
        if (!currentItem.presented) return;
        advancingRecommendationRef.current = true;
        commitGenerationState('resolving-feedback');
        try {
            await persistRecommendationSkip(currentItem, 'dojo-next-request');
            if (!mountedRef.current || activeTask.createdAt) return;
            const started = requestOneRecommendation(true);
            if (!started) commitGenerationState('ready');
        } catch (error) {
            console.warn('[PracticeDojo] could not resolve recommendation before next score:', error);
            commitGenerationState('error');
        } finally {
            advancingRecommendationRef.current = false;
        }
    }, [activeTask.createdAt, commitGenerationState, persistRecommendationSkip, requestOneRecommendation]);

    useEffect(() => () => {
        generationEpochRef.current += 1;
        sourceLoadTokenRef.current += 1;
        if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
        if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
        if (boundaryWheelResetTimerRef.current) window.clearTimeout(boundaryWheelResetTimerRef.current);
        if (generatedRevealTimerRef.current) window.clearTimeout(generatedRevealTimerRef.current);
        cancelScheduledTask(skipSignalFlushRef.current);
        visibilityObserverRef.current?.disconnect();
        visibilityTrackerRef.current?.dispose();
        const warmSession = warmSessionRef.current;
        warmSessionRef.current = null;
        warmSessionPromiseRef.current = null;
        warmSession?.close().catch((error) => (
            console.warn('[PracticeDojo] warm session cleanup failed:', error)
        ));
    }, []);

    const handleAddTask = () => {
        if (activeTask.createdAt) return;
        setActiveTask(createTaskDraft());
        requestAnimationFrame(() => {
            loadTaskCreationMenu()
                .then((TaskCreationMenu) => NiceModal.show(TaskCreationMenu))
                .catch((error) => console.warn('[PracticeDojo] task editor load failed:', error));
        });
    };

    const requestFromFeedBoundary = useCallback(() => {
        if (activeTask.createdAt || modelRequestRef.current || advancingRecommendationRef.current) return false;
        const now = Date.now();
        if (now < boundaryNextAllowedAtRef.current) return false;
        boundaryNextAllowedAtRef.current = now + 900;
        return handleAdvanceRecommendation();
    }, [activeTask.createdAt, handleAdvanceRecommendation]);

    const feedIsAtEnd = useCallback((scrollContainer) => {
        if (!scrollContainer?.isConnected) return false;
        return isAtDojoFeedEnd(
            scrollContainer.scrollTop,
            scrollContainer.scrollHeight,
            scrollContainer.clientHeight,
        );
    }, []);

    const handleFeedWheel = useCallback((event) => {
        const scrollContainer = event.currentTarget;
        if (Number(event.deltaY) <= 0 || !feedIsAtEnd(scrollContainer)) return;

        // The final card remains fixed while its response is committed and the
        // next recommendation is scored. The scorer appends and advances when done.
        if (modelRequestRef.current || advancingRecommendationRef.current) return;

        boundaryWheelDeltaRef.current += Math.max(0, Number(event.deltaY) || 0);
        if (boundaryWheelResetTimerRef.current) window.clearTimeout(boundaryWheelResetTimerRef.current);
        boundaryWheelResetTimerRef.current = window.setTimeout(() => {
            boundaryWheelResetTimerRef.current = null;
            boundaryWheelDeltaRef.current = 0;
        }, 180);

        if (boundaryWheelDeltaRef.current < 32) return;
        boundaryWheelDeltaRef.current = 0;
        requestFromFeedBoundary();
    }, [feedIsAtEnd, requestFromFeedBoundary]);

    const handleFeedTouchStart = useCallback((event) => {
        boundaryTouchStartYRef.current = Number(event.touches?.[0]?.clientY ?? Number.NaN);
        boundaryTouchTriggeredRef.current = false;
    }, []);

    const handleFeedTouchMove = useCallback((event) => {
        const scrollContainer = event.currentTarget;
        const startY = boundaryTouchStartYRef.current;
        const currentY = Number(event.touches?.[0]?.clientY ?? Number.NaN);
        if (!Number.isFinite(startY) || !Number.isFinite(currentY)) return;
        const upwardDrag = startY - currentY;
        if (upwardDrag <= 0 || !feedIsAtEnd(scrollContainer)) return;

        if (
            upwardDrag < 28
            || boundaryTouchTriggeredRef.current
            || modelRequestRef.current
            || advancingRecommendationRef.current
        ) return;

        boundaryTouchTriggeredRef.current = true;
        requestFromFeedBoundary();
    }, [feedIsAtEnd, requestFromFeedBoundary]);

    const resetFeedTouch = useCallback(() => {
        boundaryTouchStartYRef.current = null;
        boundaryTouchTriggeredRef.current = false;
    }, []);

    const handleFeedKeyDown = useCallback((event) => {
        const forwardKeys = ['ArrowDown', 'PageDown', 'End'];
        const isForwardKey = forwardKeys.includes(event.key) || (event.key === ' ' && !event.shiftKey);
        if (event.repeat || !isForwardKey || !feedIsAtEnd(event.currentTarget)) return;
        event.preventDefault();
        requestFromFeedBoundary();
    }, [feedIsAtEnd, requestFromFeedBoundary]);

    const handleFeedScroll = useCallback((event) => {
        pendingScrollContainerRef.current = event.currentTarget;
        if (scrollFrameRef.current) return;
        scrollFrameRef.current = window.requestAnimationFrame(() => {
            scrollFrameRef.current = null;
            const scrollContainer = pendingScrollContainerRef.current;
            if (!scrollContainer?.isConnected) return;

            const cardCount = feedItemsRef.current.length;
            const boundedScrollTop = clampDojoFeedScrollTop(
                scrollContainer.scrollTop,
                scrollContainer.scrollHeight,
                scrollContainer.clientHeight,
            );
            const nextIndex = dojoFeedIndexFromScroll(
                boundedScrollTop,
                scrollContainer.scrollHeight,
                scrollContainer.clientHeight,
                cardCount,
            );
            const previousIndex = activeFeedIndexRef.current;
            if (nextIndex === previousIndex) return;

            const skippedItem = feedItemsRef.current[previousIndex];
            if (skippedItem?.presented && nextIndex > previousIndex) {
                if (scrollSettleTimerRef.current) window.clearTimeout(scrollSettleTimerRef.current);
                scrollSettleTimerRef.current = window.setTimeout(() => {
                    scrollSettleTimerRef.current = null;
                    markRecommendationSkipped(
                        skippedItem,
                        Math.abs(nextIndex - previousIndex) > 2 ? 'dojo-fast-scroll-skip' : 'dojo-scroll-skip',
                    );
                }, 420);
            }
            activeFeedIndexRef.current = nextIndex;
            setActiveFeedIndex(nextIndex);
        });
    }, [markRecommendationSkipped]);

    const removeUnavailableCard = useCallback(async (itemId) => {
        const removed = feedItemsRef.current.find((item) => item.id === itemId);
        if (removed?.presented) {
            await persistRecommendationSkip(removed, 'dojo-task-unavailable').catch(() => null);
        } else if (removed) {
            await warmSessionRef.current?.invalidate(
                removed,
                'dojo-task-unavailable-before-presentation',
            ).catch(() => null);
        }
        visibilityTrackerRef.current?.discard(itemId);
        const next = feedItemsRef.current.filter((item) => item.id !== itemId);
        feedItemsRef.current = next;
        const nextIndex = clampDojoFeedIndex(activeFeedIndexRef.current, next.length);
        activeFeedIndexRef.current = nextIndex;
        setRecommendationFeed(next);
        setActiveFeedIndex(nextIndex);
        setGenerationState('ready');
        setSourceRetry((retry) => retry + 1);
    }, [persistRecommendationSkip]);

    const handlePlayRecommendation = async (item, index) => {
        if (activeTask.createdAt || launchingTaskRef.current || !item?.recommendation || !ownerId) return;
        launchingTaskRef.current = true;
        const signalKey = item.event?.UUID || item.id;
        if (signalKey) acceptedRecommendationEventsRef.current.add(signalKey);

        try {
            const liveTodo = await databaseConnection.get(STORES.todo, item.recommendation.task.UUID);
            if (
                !liveTodo
                || !isQueuedTodo(liveTodo)
                || String(currentPlayerRef.current?.UUID || '') !== String(ownerId)
            ) {
                await removeUnavailableCard(item.id);
                return;
            }

            const recommendation = { ...item.recommendation, task: liveTodo };
            const suggestedMinutes = Math.max(1, Math.round(Number(
                recommendation.suggestedMinutes || recommendation.requiredTimerMinutes || liveTodo.estimatedDuration || 25,
            )));
            const committedMs = suggestedMinutes * MINUTE;
            let recommendationEvent = item.event || null;
            try {
                if (!item.presented) {
                    item.presented = true;
                    await warmSessionRef.current?.present(item, {
                        impressionKey: 'active:interaction-presented',
                        position: index,
                        visibleMs: 0,
                    });
                }
                if (recommendationEvent?.UUID) {
                    acceptedRecommendationEventsRef.current.add(recommendationEvent.UUID);
                    visibilityTrackerRef.current?.resolve(item.id);
                    await warmSessionRef.current?.accept(item, {
                        reason: 'dojo-feed-play',
                        suggestedMinutes,
                        acceptedMinutes: suggestedMinutes,
                        committedMs,
                    });
                }
            } catch (error) {
                console.warn('[PracticeDojo] recommendation accept signal failed:', error);
            }

            if (String(currentPlayerRef.current?.UUID || '') !== String(ownerId)) return;
            const task = applyDojoRecommendationToTask(recommendation, recommendationEvent);
            if (!task) return;
            const presentedTask = {
                ...task,
                UUID: liveTodo.UUID,
                parent: liveTodo.parent,
                todoCreatedAt: liveTodo.createdAt || null,
                createdAt: null,
                sessionRequestedAt: null,
                originalDuration: Number(liveTodo.estimatedDuration || suggestedMinutes),
                estimatedDuration: Number(liveTodo.estimatedDuration || suggestedMinutes),
                sessionDuration: committedMs,
            };
            if (presentTask) {
                presentTask(presentedTask);
            } else {
                setActiveTask(presentedTask);
                requestAnimationFrame(() => {
                    loadTaskPreviewMenu()
                        .then((TaskPreviewMenu) => NiceModal.show(TaskPreviewMenu))
                        .catch((error) => console.warn('[PracticeDojo] session preview load failed:', error));
                });
            }
        } finally {
            launchingTaskRef.current = false;
        }
    };

    const handleRetryRecommendation = () => {
        if (!sourceReady) {
            setGenerationState('loading-source');
            setSourceRetry((retry) => retry + 1);
            return;
        }
        setGenerationState('ready');
        requestOneRecommendation(true);
    };

    const handleExitDojo = async () => {
        if (activeTask.createdAt) return;
        // Earlier cards are already terminal. The tail is the one staged
        // decision even when the user has reverse-scrolled before exiting.
        const item = feedItemsRef.current.at(-1);
        if (item?.presented) {
            await persistRecommendationSkip(item, 'dojo-exit-skip').catch((error) => (
                console.warn('[PracticeDojo] exit response failed:', error)
            ));
        } else if (item) {
            await warmSessionRef.current?.invalidate(item, 'dojo-exit-unviewed').catch((error) => (
                console.warn('[PracticeDojo] unviewed exit invalidation failed:', error)
            ));
            visibilityTrackerRef.current?.discard(item.id);
        }
        setGameState(GAME_STATE.idle);
    };

    const inTask = !!activeTask.createdAt;
    const modelStateLabel = dojoModelStateLabel(generationState);
    const handleOpenQueue = useCallback(() => openPanel('queue'), [openPanel]);

    return {
        activeTask,
        currentPlayer,
        dojoSessionUUID,
        elapsed,
        feedScrollerRef,
        generationState,
        handleAddTask,
        handleExitDojo,
        handleFeedKeyDown,
        handleFeedScroll,
        handleFeedTouchMove,
        handleFeedTouchStart,
        handleFeedWheel,
        handleOpenQueue,
        handlePlayRecommendation,
        handleRetryRecommendation,
        inTask,
        modelStateLabel,
        recommendationFeed,
        resetFeedTouch,
        sessionPoints,
        taskHistory,
        todoCount,
    };
}
