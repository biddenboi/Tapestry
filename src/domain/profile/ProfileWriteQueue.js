const tails = new WeakMap();

// Serialize read-modify-write settings operations across mounted surfaces.
// A failed save must not prevent the next edit from being committed.
export function queueProfileWrite(connection, write) {
  const request = (tails.get(connection) || Promise.resolve()).then(write, write);
  tails.set(connection, request.catch(() => undefined));
  return request;
}
