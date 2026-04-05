export const sendSuccess = (
  res,
  { status = 200, message = 'OK', data = null } = {}
) =>
  res.status(status).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
