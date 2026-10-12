"""Record R1 reference traces with pooled habit pacing and the habit-once free-time order.

    python3 tools/r1-parity/gen_habit.py PATH/TO/fixes/habit-sim [OUT_DIR]

PATH is the habit-ordering lab (r1.py with `variant`/`disc` switches, sim.py, peter.py).
Same recording as gen.py; crates/lot-r1/tests/parity.rs replays these with
`habit_pacing` and `habit_extra_once` on.

Runs the reference simulator (sim.py) on a spread of scenario families with
the reference core (r1.py), and records every input event and every decision
in order. crates/lot-r1/tests/parity.rs replays each trace through the Rust
port and requires the same decisions. The fixture stores the sha256 of the
r1.py it was made from, so a stale fixture is easy to spot.
"""
import hashlib, json, math, os, sys

ref = os.path.abspath(sys.argv[1])
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "../../crates/lot-r1/tests/fixtures")
sys.path.insert(0, ref)
import r1  # noqa: E402
from r1 import Params  # noqa: E402
from sim import make_scenario, run  # noqa: E402
import peter  # noqa: E402

TRACE = []
_orig_decide = r1.Lot.decide
_orig_init = r1.Lot.__init__


def _init(self, *a, **kw):
    _orig_init(self, *a, **kw)
    TRACE.append(self)
    self._decisions = []


def _decide(self, now):
    d = _orig_decide(self, now)
    self._decisions.append(dict(after=len(self.events), now=now, decision=dec_json(d)))
    return d


r1.Lot.__init__ = _init
r1.Lot.decide = _decide


def num(x):
    return None if x is None else float(x)


def ev_json(e):
    k = e[0]
    if k == "add":
        _, id, now, Q, D, start, cycle, habit, cat = e
        return dict(ev="add", id=id, now=num(now), q=num(Q), d=num(D), start=num(start), cycle=num(cycle) or None,
                    habit=bool(habit), category=cat)
    if k == "estimate":
        return dict(ev="estimate", id=e[1], now=num(e[2]), q=num(e[3]))
    if k == "deadline":
        return dict(ev="deadline", id=e[1], now=num(e[2]), d=num(e[3]))
    if k == "start":
        return dict(ev="start", id=e[1], now=num(e[2]), start=num(e[3]))
    if k == "complete":
        return dict(ev="complete", id=e[1], now=num(e[2]))
    if k == "log":
        return dict(ev="log", start=num(e[1]), dur=num(e[2]), kind=e[3], ref=e[4])
    raise ValueError(k)


def alert_json(a):
    if a[0] == "overload":
        return dict(alert="overload", **{"from": num(a[1])}, to=num(a[2]), short=num(a[3]))
    return dict(alert="overdue", id=a[1])


def dec_json(d):
    return dict(kind=d.kind, ref=d.ref, length=num(d.length), rule=d.rule, mode=d.mode,
                alerts=[alert_json(a) for a in d.alerts], prompts=list(d.prompts), basis=d.basis)


def main():
    sha = hashlib.sha256(open(os.path.join(ref, "r1.py"), "rb").read()).hexdigest()
    os.makedirs(out, exist_ok=True)
    cases = []
    plan = [(fam, seed) for fam in ("typical", "busy", "nondaily", "peter") for seed in (900001, 900002, 900003, 900004)]
    for fam, seed in plan:
        for policy in ("r1",):
            TRACE.clear()
            P = Params(policy=policy, variant="pooled", disc="habit-once", tie_guard="plain")
            sc = peter.make(seed) if fam == "peter" else make_scenario(fam, seed, H=28, s=P.s)
            run(sc, P)
            lot = TRACE[0]
            cases.append(dict(family=fam, seed=seed, policy=policy, s=P.s,
                              rewards=sc.rewards, rest=float(sc.rest),
                              events=[ev_json(e) for e in lot.events], decisions=lot._decisions,
                              missed=[dict(id=m[0], d=num(m[1]), habit_floor=m[2] == "floor") for m in lot.missed]))
    path = os.path.join(out, "r1_habit_traces.json")
    with open(path, "w") as fh:
        json.dump(dict(r1_sha256=sha, cases=cases), fh, separators=(",", ":"))
    n = sum(len(c["decisions"]) for c in cases)
    print(f"{len(cases)} traces, {n} decisions -> {path} (r1.py sha256 {sha[:12]})")


if __name__ == "__main__":
    main()
