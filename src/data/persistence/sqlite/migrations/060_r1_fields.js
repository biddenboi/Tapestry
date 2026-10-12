export const R1_FIELDS_SQL = `ALTER TABLE todos ADD COLUMN start_date TEXT;
ALTER TABLE todos ADD COLUMN is_habit INTEGER NOT NULL DEFAULT 0 CHECK(is_habit IN (0,1));
ALTER TABLE todos ADD COLUMN habit_min_minutes INTEGER CHECK(habit_min_minutes IS NULL OR habit_min_minutes > 0);
CREATE TRIGGER r1_todo_fields_insert AFTER INSERT ON todos BEGIN
  UPDATE todos SET start_date=json_extract(NEW.extra_json,'$.startDate'),
    is_habit=CASE WHEN json_extract(NEW.extra_json,'$.isHabit')=1 THEN 1 ELSE 0 END,
    habit_min_minutes=json_extract(NEW.extra_json,'$.habitMinMinutes') WHERE id=NEW.id;
END;
CREATE TRIGGER r1_todo_fields_update AFTER UPDATE OF extra_json ON todos BEGIN
  UPDATE todos SET start_date=json_extract(NEW.extra_json,'$.startDate'),
    is_habit=CASE WHEN json_extract(NEW.extra_json,'$.isHabit')=1 THEN 1 ELSE 0 END,
    habit_min_minutes=json_extract(NEW.extra_json,'$.habitMinMinutes') WHERE id=NEW.id;
END;`;
export default Object.freeze({ id: "060_r1_fields", description: "Add optional R1 start and habit fields with typed projections.", sourceApplicationVersion: "r1", sql: R1_FIELDS_SQL, checksum: "138ba5b6dbe8fcc141dba1bd4eb3986d1af3f131e2625aabfd8bb424659f63c2" });
