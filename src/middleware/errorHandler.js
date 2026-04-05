export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} was not found.`,
    timestamp: new Date().toISOString(),
  });
};

export const errorHandler = (error, req, res, next) => {
  void req;
  void next;

  const duplicateKeyError = error?.code === 11000;
  const validationError = error?.name === 'ValidationError';
  const castError = error?.name === 'CastError';

  let statusCode = error.statusCode ?? 500;
  let message = error.message || 'Internal server error';
  let details = error.details;

  if (duplicateKeyError) {
    statusCode = 409;
    const duplicateField = Object.keys(error.keyPattern ?? {})[0] ?? 'field';
    message = `${duplicateField} already exists.`;
  }

  if (validationError) {
    statusCode = 400;
    details = Object.values(error.errors).map((item) => item.message);
  }

  if (castError) {
    statusCode = 400;
    message = `Invalid value for ${error.path}.`;
  }

  res.status(statusCode).json({
    success: false,
    message,
    details,
    timestamp: new Date().toISOString(),
  });
};
