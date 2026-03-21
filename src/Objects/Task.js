class Task {
    constructor(data) {
        this._createdAt = data.createdAt;
        this._distractions = data.distractions;
        this._duration = data.duration;
        this._parent = data.parent;
        this._efficiency = data.efficiency;
        this._estimatedBuffer = data.estimatedBuffer;
        this._estimatedDuration = data.estimatedDuration;
        this._location = data.location;
        this._points = data.points;
        this._reasonToSelect = data.reasonToSelect;
        this._similarity = data.similarity;
        this._taskName = data.taskName;
        this._timeOfStart = data.timeOfStart;
        this._completedAt = data.completedAt;
    }

    get createdAt() {
        return this._createdAt;
    }

    set createdAt(value) {
        this._createdAt = value;
    }

    get distractions() {
        return this._distractions;
    }

    set distractions(value) {
        this._distractions = value;
    }

    get duration() {
        return this._duration;
    }

    set duration(value) {
        this._duration = value;
    }

    get parent() {
        return this._parent;
    }

    set parent(value) {
        this._parent = value;
    }

    get efficiency() {
        return this._efficiency;
    }

    set efficiency(value) {
        this._efficiency = value;
    }

    get estimatedBuffer() {
        return this._estimatedBuffer;
    }

    set estimatedBuffer(value) {
        this._estimatedBuffer = value;
    }

    get estimatedDuration() {
        return this._estimatedDuration;
    }

    set estimatedDuration(value) {
        this._estimatedDuration = value;
    }

    get location() {
        return this._location;
    }

    set location(value) {
        this._location = value;
    }

    get points() {
        return this._points;
    }

    set points(value) {
        this._points = value;
    }

    get reasonToSelect() {
        return this._reasonToSelect;
    }

    set reasonToSelect(value) {
        this._reasonToSelect = value;
    }

    get similarity() {
        return this._similarity;
    }

    set similarity(value) {
        this._similarity = value;
    }

    get taskName() {
        return this._taskName;
    }

    set taskName(value) {
        this._taskName = value;
    }

    get timeOfStart() {
        return this._timeOfStart;
    }

    set timeOfStart(value) {
        this._timeOfStart = value;
    }

    get completedAt() {
        return this._completedAt;
    }

    set completedAt(value) {
        this._completedAt = value;
    }
}