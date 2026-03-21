export class Event {
    constructor(data = {}) {
        this._UUID = data.UUID;
        this._type = data.type;
        this._description = data.description;
        this._createdAt = data.createdAt;
        this._parent = data.parent;
    }

    get UUID() {
        return this._UUID;
    }

    set UUID(value) {
        this._UUID = value;
    }

    get type() {
        return this._type;
    }

    set type(value) {
        this._type = value;
    }

    get description() {
        return this._description;
    }

    set description(value) {
        this._description = value;
    }

    get createdAt() {
        return this._createdAt;
    }

    set createdAt(value) {
        this._createdAt = value;
    }

    get parent() {
        return this._parent;
    }

    set parent(value) {
        this._parent = value;
    }
}