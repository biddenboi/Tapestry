# Task Recommender V12

Task Recommender V12 is the only active recommendation runtime. Its public
entry point is `domain/tasks/TaskRecommender.js`; policy state, evidence,
training, and lifecycle code remain in the `TaskRecommenderV12*` modules.

V11 data is read only by the explicit offline migration path. Removed V11
runtime modules and the transitional cutover inventory must not be restored or
imported by production code. New serving behavior should preserve the runtime
boundary declared in `domain/tasks/TaskRecommenderV12Boundary.js`.
