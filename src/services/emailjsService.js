import { env } from '../config/env.js';

const EMAILJS_SEND_URL = 'https://api.emailjs.com/api/v1.0/email/send';

const isConfigured = (templateId = env.emailjsTemplateId) =>
  Boolean(
    env.emailjsServiceId &&
      templateId &&
      env.emailjsPublicKey
  );

const createConfigurationError = (contextLabel) => {
  const error = new Error(
    `${contextLabel} email is not configured. Add the EmailJS backend environment variables first.`
  );
  error.statusCode = 503;
  return error;
};

const buildEmailJsError = (response, responseText, contextLabel) => {
  const normalizedResponseText = String(responseText ?? '').trim();

  if (
    response.status === 403 &&
    normalizedResponseText.toLowerCase().includes('non-browser environments')
  ) {
    const error = new Error(
      `EmailJS is blocking backend ${contextLabel.toLowerCase()} sends. In EmailJS dashboard, open Account > Security and enable API access for non-browser environments.`
    );
    error.statusCode = 503;
    error.details = [normalizedResponseText];
    return error;
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    const error = new Error(
      `EmailJS rejected the ${contextLabel.toLowerCase()} request. Check your service ID, template ID, public key, private key, and EmailJS account security settings.`
    );
    error.statusCode = 502;
    error.details = normalizedResponseText ? [normalizedResponseText] : undefined;
    return error;
  }

  const error = new Error(
    `Unable to send ${contextLabel.toLowerCase()} right now. Please try again later.`
  );
  error.statusCode = 502;
  error.details = normalizedResponseText ? [normalizedResponseText] : undefined;
  return error;
};

const sendEmailJsTemplate = async ({
  templateId,
  templateParams,
  contextLabel,
}) => {
  if (!isConfigured(templateId)) {
    throw createConfigurationError(contextLabel);
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
        template_id: templateId,
        user_id: env.emailjsPublicKey,
        ...(env.emailjsPrivateKey
          ? {
              accessToken: env.emailjsPrivateKey,
            }
          : {}),
        template_params: templateParams,
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
  throw buildEmailJsError(response, responseText, contextLabel);
};

export const sendPasswordResetOtpEmail = async ({
  toEmail,
  toName,
  otpCode,
}) =>
  sendEmailJsTemplate({
    templateId: env.emailjsTemplateId,
    contextLabel: 'Password recovery',
    templateParams: {
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
  });

export const sendUserAccountCredentialsEmail = async ({
  toEmail,
  toName,
  roleLabel,
  temporaryPassword,
}) =>
  sendEmailJsTemplate({
    templateId: env.emailjsUserWelcomeTemplateId ?? env.emailjsTemplateId,
    contextLabel: 'User account credentials',
    templateParams: {
      app_name: env.emailjsAppName,
      to_email: toEmail,
      email: toEmail,
      user_email: toEmail,
      recipient_email: toEmail,
      login_email: toEmail,
      account_email: toEmail,
      to_name: toName,
      name: toName,
      user_name: toName,
      recipient_name: toName,
      role: roleLabel,
      user_role: roleLabel,
      temporary_password: temporaryPassword,
      generated_password: temporaryPassword,
      password: temporaryPassword,
      support_email: env.emailjsSupportEmail ?? '',
      reply_to: env.emailjsSupportEmail ?? '',
      subject: `${env.emailjsAppName} account credentials`,
      headline: `Your ${env.emailjsAppName} account is ready`,
      message: `Your ${env.emailjsAppName} account has been created.\n\nSign in email: ${toEmail}\nTemporary password: ${temporaryPassword}\nRole: ${roleLabel}\n\nFor security, please change your password after your first sign-in.`,
    },
  });
