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

const buildEmailJsError = (response, responseText) => {
  const normalizedResponseText = String(responseText ?? '').trim();

  if (
    response.status === 403 &&
    normalizedResponseText.toLowerCase().includes('non-browser environments')
  ) {
    const error = new Error(
      'EmailJS is blocking backend OTP sends. In EmailJS dashboard, open Account > Security and enable API access for non-browser environments.'
    );
    error.statusCode = 503;
    error.details = [normalizedResponseText];
    return error;
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    const error = new Error(
      'EmailJS rejected the OTP request. Check your service ID, template ID, public key, private key, and EmailJS account security settings.'
    );
    error.statusCode = 502;
    error.details = normalizedResponseText ? [normalizedResponseText] : undefined;
    return error;
  }

  const error = new Error(
    'Unable to send OTP right now. Please try again later.'
  );
  error.statusCode = 502;
  error.details = normalizedResponseText ? [normalizedResponseText] : undefined;
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
          code: otpCode,
          to_email: toEmail,
          email: toEmail,
          user_email: toEmail,
          recipient_email: toEmail,
          to_name: toName,
          name: toName,
          user_name: toName,
          support_email: env.emailjsSupportEmail ?? '',
          reply_to: env.emailjsSupportEmail ?? '',
          expires_in_minutes: String(env.passwordResetOtpExpiresMinutes),
          subject: `${env.emailjsAppName} password reset OTP`,
          message: `Your ${env.emailjsAppName} OTP is ${otpCode}. It expires in ${env.passwordResetOtpExpiresMinutes} minutes.`,
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
  throw buildEmailJsError(response, responseText);
};
