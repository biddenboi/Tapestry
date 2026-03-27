import { v4 as uuid } from "uuid";
import { addDurationToDate } from '../../utils/Helpers/Time.js';
import { DAY } from "../Constants.js";
import JournalPopup from "../../Modals/JournalPopup/JournalPopup.jsx";
import NiceModal from '@ebay/nice-modal-react';

export const endDay = async (db, player, early) => {
    const yesterday = addDurationToDate(new Date(), -DAY);
    player.tokens = early ? player.tokens / 2 : 0;

    await db.addEvent({
          type: "exit",
          description: early ? "Early!" : "Exited On Time",
          UUID: uuid(),
          parent: player.UUID,
          createdAt: yesterday.toISOString()
    })

    await db.addPlayer(player);
}

export const startDay = async (db, player) => {
    
    await db.addEvent({
          type: "enter",
          description: "Started the Day",
          UUID: uuid(),
          parent: player.UUID,
          createdAt: new Date().toISOString()
    });
};

export const endWorkDay = (async (db, player) => {
    NiceModal.show(JournalPopup, { title: "End of Workday Conclusions"})
    await db.addEvent({
          type: "end-work",
          description: "Ended the Workday",
          UUID: uuid(),
          parent: player.UUID,
          createdAt: new Date().toISOString()
    })
})
