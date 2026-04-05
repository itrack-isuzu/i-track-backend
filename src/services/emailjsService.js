import { env } from '../config/env.js';

const EMAILJS_SEND_URL = 'https://api.emailjs.com/api/v1.0/email/send';

const isConfigured = () =>
  Boolean(
    env.emailjsServiceId &&
      env.emailjsTemplateId &&
      env.emailjsPublicKey
  );

const createConfigurationError = () => {
  const error = new Error(
    'Password recovery email is not configured. Add the EmailJS backend environment variables first.'
  );
  error.statusCode = 503;
  return error;
};

export const sendPasswordResetOtpEmail = async ({
  toEmail,
  toName,
  otpCode,
}) => {
  if (!isConfigured()) {
    throw createConfigurationError();
  }

  let response;

  try {
    response = await fetch(EMAILJS_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        service_id: env.emailjsServiceId,
        template_id: env.emailjsTemplateId,
        user_id: env.emailjsPublicKey,
        ...(env.emailjsPrivateKey
          ? {
              accessToken: env.emailjsPrivateKey,
            }
          : {}),
        template_params: {
          app_name: env.emailjsAppName,
          otp_code: otpCode,
          otp: otpCode,
          passcode: otpCode,
          to_email: toEmail,
          to_name: toName,
          support_email: env.emailjsSupportEmail ?? '',
          expires_in_minutes: String(env.passwordResetOtpExpiresMinutes),
        },
      }),
    });
  } catch {
    const error = new Error(
      'Unable to reach EmailJS right now. Please try again later.'
    );
    error.statusCode = 502;
    throw error;
  }

  if (response.ok) {
    return;
  }

  const responseText = await response.text().catch(() => '');
  const error = new Error(
    'Unable to send the password reset email right now. Please try again later.'
  );
  error.statusCode = 502;
  error.details = responseText ? [responseText] : undefined;
  throw error;
};
