import { env } from '../config/env.js';
import { normalizePhoneNumber } from '../utils/phoneNumbers.js';

const buildPreparationCompletionMessage = ({
  customerName,
  vehicleLabel,
}) => {
  const resolvedCustomerName = String(customerName ?? '').trim() || 'Customer';
  const resolvedVehicleLabel = String(vehicleLabel ?? '').trim() || 'your vehicle';

  return `Hi ${resolvedCustomerName}! Your ${resolvedVehicleLabel} is ready for release. Contact your agent for details. -Isuzu Pasig`;
};

const toPhilippineE164 = (value) => {
  const normalizedPhoneNumber = normalizePhoneNumber(value);

  if (!normalizedPhoneNumber) {
    return '';
  }

  if (normalizedPhoneNumber.startsWith('09') && normalizedPhoneNumber.length === 11) {
    return `+63${normalizedPhoneNumber.slice(1)}`;
  }

  if (normalizedPhoneNumber.startsWith('63') && normalizedPhoneNumber.length === 12) {
    return `+${normalizedPhoneNumber}`;
  }

  if (normalizedPhoneNumber.startsWith('9') && normalizedPhoneNumber.length === 10) {
    return `+63${normalizedPhoneNumber}`;
  }

  return normalizedPhoneNumber.startsWith('+')
    ? normalizedPhoneNumber
    : normalizedPhoneNumber;
};

const toLocalMobileNumber = (value) => normalizePhoneNumber(value);

const getTwilioEndpoint = () =>
  `https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`;

const getFmcsmsEndpoint = () => env.fmcsmsApiUrl;

const isFmcsmsConfigured = () =>
  Boolean(
    env.smsEnabled &&
      env.fmcsmsApiUrl &&
      env.fmcsmsUsername &&
      env.fmcsmsPassword &&
      env.fmcsmsSenderId
  );

const isTwilioConfigured = () =>
  Boolean(
    env.smsEnabled &&
      env.twilioAccountSid &&
      env.twilioAuthToken &&
      (env.twilioMessagingServiceSid || env.twilioFromNumber)
  );

const parseJsonSafely = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const isSuccessfulFmcsmsResponse = (rawResponseBody, responseBody) => {
  const normalizedBody = String(rawResponseBody ?? '').trim();
  const normalizedJsonMessage = String(
    responseBody?.message ?? responseBody?.status ?? responseBody?.detail ?? ''
  ).trim();

  const successPatterns = [/^1701$/, /^111[123](:|$)/i, /\b(success|queued)\b/i];

  return [normalizedBody, normalizedJsonMessage].some((candidate) =>
    successPatterns.some((pattern) => pattern.test(candidate))
  );
};

const sendPreparationCompletionSmsViaFmcsms = async ({
  customerName,
  phoneNumber,
  vehicleLabel,
}) => {
  if (!isFmcsmsConfigured()) {
    console.warn(
      'Preparation completion SMS skipped because FMCSMS is not configured.'
    );

    return {
      skipped: true,
      reason: 'unconfigured',
    };
  }

  const smsRecipient = toLocalMobileNumber(phoneNumber);

  if (!smsRecipient.startsWith('09') || smsRecipient.length !== 11) {
    throw new Error('Customer contact number is not in a supported SMS format.');
  }

  const endpoint = new URL(getFmcsmsEndpoint());
  endpoint.searchParams.set('username', env.fmcsmsUsername);
  endpoint.searchParams.set('password', env.fmcsmsPassword);
  endpoint.searchParams.set('sid', env.fmcsmsSenderId);
  endpoint.searchParams.set('mno', smsRecipient);
  endpoint.searchParams.set(
    'msg',
    buildPreparationCompletionMessage({
      customerName,
      vehicleLabel,
    })
  );
  endpoint.searchParams.set('mt', '0');
  endpoint.searchParams.set('fl', '0');

  const response = await fetch(endpoint, {
    method: 'GET',
  });
  const rawResponseBody = (await response.text()).trim();
  const responseBody = parseJsonSafely(rawResponseBody);

  if (!response.ok) {
    throw new Error(
      String(
        responseBody?.message ??
          responseBody?.detail ??
          rawResponseBody ??
          'Unable to send preparation completion SMS.'
      ).trim()
    );
  }

  if (/^\d+$/.test(rawResponseBody) && rawResponseBody !== '1701') {
    throw new Error(`FMCSMS returned code ${rawResponseBody}.`);
  }

  if (rawResponseBody && /(error|invalid|failed)/i.test(rawResponseBody)) {
    throw new Error(rawResponseBody);
  }

  if (!isSuccessfulFmcsmsResponse(rawResponseBody, responseBody)) {
    throw new Error(
      rawResponseBody || 'FMCSMS returned an unexpected response.'
    );
  }

  return {
    skipped: false,
    provider: 'fmcsms',
    sid: rawResponseBody || null,
    to: smsRecipient,
  };
};

const sendPreparationCompletionSmsViaTwilio = async ({
  customerName,
  phoneNumber,
  vehicleLabel,
}) => {
  if (!isTwilioConfigured()) {
    console.warn(
      'Preparation completion SMS skipped because Twilio is not configured.'
    );

    return {
      skipped: true,
      reason: 'unconfigured',
    };
  }

  const smsRecipient = toPhilippineE164(phoneNumber);

  if (!smsRecipient.startsWith('+63')) {
    throw new Error('Customer contact number is not in a supported SMS format.');
  }

  const payload = new URLSearchParams({
    To: smsRecipient,
    Body: buildPreparationCompletionMessage({
      customerName,
      vehicleLabel,
    }),
  });

  if (env.twilioMessagingServiceSid) {
    payload.set('MessagingServiceSid', env.twilioMessagingServiceSid);
  } else if (env.twilioFromNumber) {
    payload.set('From', env.twilioFromNumber);
  }

  const response = await fetch(getTwilioEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${env.twilioAccountSid}:${env.twilioAuthToken}`
      ).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      String(
        responseBody?.message ??
          responseBody?.detail ??
          'Unable to send preparation completion SMS.'
      ).trim()
    );
  }

  return {
    skipped: false,
    provider: 'twilio',
    sid: responseBody?.sid ?? null,
    to: smsRecipient,
  };
};

export const sendPreparationCompletionSms = async ({
  customerName,
  phoneNumber,
  vehicleLabel,
}) => {
  if (!env.smsEnabled) {
    return {
      skipped: true,
      reason: 'disabled',
    };
  }

  if (env.smsProvider === 'fmcsms') {
    return sendPreparationCompletionSmsViaFmcsms({
      customerName,
      phoneNumber,
      vehicleLabel,
    });
  }

  return sendPreparationCompletionSmsViaTwilio({
    customerName,
    phoneNumber,
    vehicleLabel,
  });
};
