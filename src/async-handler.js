// Wrapper async handler untuk Express 4 agar error async diteruskan ke middleware error handling.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

