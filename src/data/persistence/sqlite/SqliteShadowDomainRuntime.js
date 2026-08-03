import CoreProfileShadowImporter from './CoreProfileShadowImporter.js';
import JournalRelationsShadowImporter from './JournalRelationsShadowImporter.js';
import JournalShadowImporter from './JournalShadowImporter.js';
import PlanningShadowImporter from './PlanningShadowImporter.js';
import ProtectedNotesShadowImporter from './ProtectedNotesShadowImporter.js';
import SqliteCoreProfileRepository from './SqliteCoreProfileRepository.js';
import SqliteJournalRepository from './SqliteJournalRepository.js';
import SqlitePlanningRepository from './SqlitePlanningRepository.js';
import SqliteProtectedNotesRepository from './SqliteProtectedNotesRepository.js';
import JournalFileOperationService from '../journals/JournalFileOperationService.js';
import ResourceOperationService from '../resources/ResourceOperationService.js';
import ResourceShadowImporter from './ResourceShadowImporter.js';
import MatchesShadowImporter from './MatchesShadowImporter.js';
import EventsShadowImporter from './EventsShadowImporter.js';
import CommerceShadowImporter from './CommerceShadowImporter.js';
import SqliteMatchesRepository from './SqliteMatchesRepository.js';
import SqliteEventsRepository from './SqliteEventsRepository.js';
import SqliteCommerceRepository from './SqliteCommerceRepository.js';
import SocialShadowImporter from './SocialShadowImporter.js';
import RecoveryModelShadowImporter from './RecoveryModelShadowImporter.js';
import SqliteSocialRepository from './SqliteSocialRepository.js';
import SqliteSocialWorldRepository from './SqliteSocialWorldRepository.js';
import SqliteRecoveryModelRepository from './SqliteRecoveryModelRepository.js';
import DojoStandingsService from '../services/DojoStandingsService.js';

export class SqliteShadowDomainRuntime {
  constructor({ client, now = () => new Date(), random = Math.random } = {}) {
    if (!client) throw new Error('SqliteShadowDomainRuntime requires a SQLite client.');
    this.client = client;
    this.now = now;
    this.coreProfiles = new SqliteCoreProfileRepository({ client, now });
    this.planning = new SqlitePlanningRepository({ client, now });
    this.notes = new SqliteProtectedNotesRepository({ client, now });
    this.journals = new SqliteJournalRepository({ client, now, random });
    this.matches = new SqliteMatchesRepository({ client, now });
    this.events = new SqliteEventsRepository({ client, now });
    this.commerce = new SqliteCommerceRepository({ client, now });
    this.social = new SqliteSocialRepository({ client, now });
    this.socialWorld = new SqliteSocialWorldRepository({ client, now });
    this.recoveryModel = new SqliteRecoveryModelRepository({ client, now });
    this.dojoStandings = new DojoStandingsService({ client, now });
    this.importers = Object.freeze({
      coreProfiles: new CoreProfileShadowImporter({ client, now }),
      planning: new PlanningShadowImporter({ client, now }),
      notes: new ProtectedNotesShadowImporter({ client, now }),
      journals: new JournalShadowImporter({ client, now }),
      journalRelations: new JournalRelationsShadowImporter({ client, now }),
      matches: new MatchesShadowImporter({ client, now }),
      events: new EventsShadowImporter({ client, now }),
      commerce: new CommerceShadowImporter({ client, now }),
      social: new SocialShadowImporter({ client, now }),
      recoveryModel: new RecoveryModelShadowImporter({ client, now }),
    });
    Object.freeze(this.importers);
  }

  createJournalFileOperations(fileAdapter, options = {}) {
    return new JournalFileOperationService({
      client: this.client,
      fileAdapter,
      now: this.now,
      ...options,
    });
  }

  createResourceOperations(fileAdapter, options = {}) {
    return new ResourceOperationService({
      client: this.client,
      fileAdapter,
      now: this.now,
      ...options,
    });
  }

  createResourceImporter(fileAdapter, options = {}) {
    const service = this.createResourceOperations(fileAdapter, options);
    return new ResourceShadowImporter({ client: this.client, service, now: this.now });
  }

  createJournalRepository({ fileAdapter = null, random = Math.random } = {}) {
    return new SqliteJournalRepository({ client: this.client, fileAdapter, now: this.now, random });
  }
}

export default SqliteShadowDomainRuntime;
