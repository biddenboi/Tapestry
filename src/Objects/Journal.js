export class Journal {
    constructor(data = {}) {
        this._UUID = data.UUID;
        this._createdAt = data.createdAt;
        this._title = data.title;
        this._entry = data.entry;
        this._parent = data.parent;
    }

    get UUID() {
        return this._UUID;
    }

    set UUID(value) {
        this._UUID = value;
    }

    get createdAt() {
        return this._createdAt;
    }

    set createdAt(value) {
        this._createdAt = value;
    }

    get title() {
        return this._title;
    }

    set title(value) {
        this._title = value;
    }

    get entry() {
        return this._entry;
    }

    set entry(value) {
        this._entry = value;
    }

    get parent() {
        return this._parent;
    }

    set parent(value) {
        this._parent = value;
    }
}