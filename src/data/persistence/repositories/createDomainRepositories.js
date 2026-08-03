import TaskRepository from '@data/persistence/repositories/TaskRepository.js';
import MatchRepository from '@data/persistence/repositories/MatchRepository.js';
import ProfileRepository from '@data/persistence/repositories/ProfileRepository.js';
import FeedRepository from '@data/persistence/repositories/FeedRepository.js';
import InventoryRepository from '@data/persistence/repositories/InventoryRepository.js';
import ShopRepository from '@data/persistence/repositories/ShopRepository.js';
import RecommenderRepository from '@data/persistence/repositories/RecommenderRepository.js';
import DerivedCacheRepository from '@data/persistence/repositories/DerivedCacheRepository.js';
import NotesRepository from '@data/persistence/repositories/NotesRepository.js';
import GoalRepository from '@data/persistence/repositories/GoalRepository.js';

export function createDomainRepositories(connection) {
  return Object.freeze({
    tasks: new TaskRepository(connection),
    matches: new MatchRepository(connection),
    profiles: new ProfileRepository(connection),
    feed: new FeedRepository(connection),
    shop: new ShopRepository(connection),
    inventory: new InventoryRepository(connection),
    recommender: new RecommenderRepository(connection),
    derivedCaches: new DerivedCacheRepository(connection),
    notes: new NotesRepository(connection),
    goals: new GoalRepository(connection),
  });
}

export default createDomainRepositories;
