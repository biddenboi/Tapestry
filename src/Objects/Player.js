export class Player {
    constructor(data = {}) {
        this._UUID = data.UUID;
        this._username = data.username;
        this._createdAt = data.createdAt;
        this._description = data.description;
        this._tokens = data.tokens;
        this._wakeTime = data.wakeTime;
        this._sleepTime = data.sleepTime;
    }

    get UUID() {
        return this._UUID;
    }

    set UUID(value) {
        this._UUID = value;
    }

    get username() {
        return this._username;
    }

    set username(value) {
        this._username = value;
    }

    get createdAt() {
        return this._createdAt;
    }

    set createdAt(value) {
        this._createdAt = value;
    }

    get description() {
        return this._description;
    }

    set description(value) {
        this._description = value;
    }

    get tokens() {
        return this._tokens;
    }

    set tokens(value) {
        this._tokens = value;
    }

    get wakeTime() {
        return this._wakeTime;
    }

    set wakeTime(value) {
        this._wakeTime = value;
    }

    get sleepTime() {
        return this._sleepTime;
    }

    set sleepTime(value) {
        this._sleepTime = value;
    }
}