import { env } from '../config/env.js';

const normalizeSmsDigits = (value) =>
  String(value ?? '').replace(/\D/g, '');

const buildPreparationCompletionMessage = ({
  customerName,
  vehicleLabel,
}) => {
  const resolvedCustomerName = String(customerName ?? '').trim() || 'Customer';
  const resolvedVehicleLabel = String(vehicleLabel ?? '').trim() || 'your vehicle';

  return `Hi ${resolvedCustomerName}! Your ${resolvedVehicleLabel} is ready for release. Contact your agent for details. -Isuzu Pasig`;
};

const toPhilippineE164 = (value) => {
  const normalizedPhoneNumber = normalizeSmsDigits(value);

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

const toFmcsmsMobileNumber = (value) => {
  const normalizedPhoneNumber = normalizeSmsDigits(value);

  if (!normalizedPhoneNumber) {
    return '';
  }

  if (normalizedPhoneNumber.startsWith('09') && normalizedPhoneNumber.length === 11) {
    return `63${normalizedPhoneNumber.slice(1)}`;
  }

  if (normalizedPhoneNumber.startsWith('63') && normalizedPhoneNumber.length === 12) {
    return normalizedPhoneNumber;
  }

  if (normalizedPhoneNumber.startsWith('9') && normalizedPhoneNumber.length === 10) {
    return `63${normalizedPhoneNumber}`;
  }

  return normalizedPhoneNumber;
};

const getTwilioEndpoint = () =>
  `https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`;

const FORTMED_REFERENCE_ENDPOINT =
  'https://fortmed.org/web/FMCSMS/api/messages.php';

const isFortmedConfigured = () =>
  Boolean(env.smsEnabled && env.fortmedApiUrl && env.fortmedApiKey);

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

const maskPhoneNumber = (value) => {
  const normalizedValue = String(value ?? '').trim();

  if (normalizedValue.length <= 4) {
    return normalizedValue;
  }

  return `${'*'.repeat(Math.max(normalizedValue.length - 4, 0))}${normalizedValue.slice(-4)}`;
};

const maskApiKey = (value) => {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return '';
  }

  if (normalizedValue.length <= 8) {
    return `${normalizedValue.slice(0, 2)}***`;
  }

  return `${normalizedValue.slice(0, 8)}********************`;
};

const isSuccessfulFortmedResponse = (responseBody) => {
  if (!responseBody) {
    return false;
  }

  if (typeof responseBody === 'string') {
    return /\b(success|queued|accepted|sent)\b/i.test(responseBody);
  }

  return Boolean(
    responseBody.success === true ||
      responseBody.IsSuccessful === true ||
      responseBody.isSuccessful === true ||
      responseBody.status === 'success' ||
      responseBody.result === 'success'
  );
};

const isFortmedDnsFailure = (error) =>
  error instanceof TypeError &&
  error?.cause &&
  typeof error.cause === 'object' &&
  error.cause !== null &&
  'code' in error.cause &&
  error.cause.code === 'ENOTFOUND';

const isLegacyFortmedHostname = (value) => {
  try {
    return new URL(String(value ?? '')).hostname === 'api.fortmedph.com';
  } catch {
    return false;
  }
};

const postFortmedSms = async ({ endpoint, payload }) => {
  console.log('[SMS][Fortmed] Starting preparation completion SMS send.', {
    provider: env.smsProvider,
    endpoint,
    senderName: payload.SenderName,
    fromNumber: payload.FromNumber ? maskPhoneNumber(payload.FromNumber) : null,
    toNumber: maskPhoneNumber(payload.ToNumber),
    apiKey: maskApiKey(env.fortmedApiKey),
    vehicleLabel: payload.MessageBody ? 'included' : 'missing',
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.fortmedApiKey,
    },
    body: JSON.stringify(payload),
  });

  const rawResponseBody = await response.text();
  const responseBody = parseJsonSafely(rawResponseBody) ?? rawResponseBody;

  console.log('[SMS][Fortmed] Response received.', {
    endpoint,
    status: response.status,
    ok: response.ok,
    body:
      typeof responseBody === 'object' && responseBody !== null
        ? responseBody
        : String(rawResponseBody ?? '').trim(),
  });

  return {
    response,
    rawResponseBody,
    responseBody,
  };
};

const sendPreparationCompletionSmsViaFortmed = async ({
  customerName,
  phoneNumber,
  vehicleLabel,
}) => {
  if (!isFortmedConfigured()) {
    console.warn(
      'Preparation completion SMS skipped because Fortmed is not configured.'
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

  const payload = {
    SenderName: env.fortmedSenderId ?? 'I-Track',
    ToNumber: smsRecipient,
    MessageBody: buildPreparationCompletionMessage({
      customerName,
      vehicleLabel,
    }),
  };

  if (env.fortmedFromNumber) {
    payload.FromNumber = env.fortmedFromNumber;
  }
  let response;
  let rawResponseBody;
  let responseBody;
  let activeEndpoint = env.fortmedApiUrl;

  try {
    ({
      response,
      rawResponseBody,
      responseBody,
    } = await postFortmedSms({
      endpoint: activeEndpoint,
      payload,
    }));
  } catch (error) {
    if (
      isFortmedDnsFailure(error) &&
      isLegacyFortmedHostname(activeEndpoint) &&
      activeEndpoint !== FORTMED_REFERENCE_ENDPOINT
    ) {
      console.warn(
        '[SMS][Fortmed] Primary Fortmed hostname could not be resolved. Retrying with reference endpoint.',
        {
          failedEndpoint: activeEndpoint,
          fallbackEndpoint: FORTMED_REFERENCE_ENDPOINT,
        }
      );

      activeEndpoint = FORTMED_REFERENCE_ENDPOINT;
      ({
        response,
        rawResponseBody,
        responseBody,
      } = await postFortmedSms({
        endpoint: activeEndpoint,
        payload,
      }));
    } else {
      throw error;
    }
  }

  if (!response.ok) {
    console.error('[SMS][Fortmed] Request failed.', {
      endpoint: activeEndpoint,
      status: response.status,
      body:
        typeof responseBody === 'object' && responseBody !== null
          ? responseBody
          : String(rawResponseBody ?? '').trim(),
    });

    throw new Error(
      String(
        (typeof responseBody === 'object' && responseBody !== null
          ? responseBody.message ??
            responseBody.detail ??
            responseBody.error
          : responseBody) || 'Unable to send preparation completion SMS.'
      ).trim()
    );
  }

  if (!isSuccessfulFortmedResponse(responseBody)) {
    console.error('[SMS][Fortmed] Unexpected success payload.', {
      endpoint: activeEndpoint,
      status: response.status,
      body:
        typeof responseBody === 'object' && responseBody !== null
          ? responseBody
          : String(rawResponseBody ?? '').trim(),
    });

    throw new Error(
      String(
        (typeof responseBody === 'object' && responseBody !== null
          ? responseBody.message ??
            responseBody.detail ??
            responseBody.error
          : responseBody) || 'Fortmed returned an unexpected response.'
      ).trim()
    );
  }

  console.log('[SMS][Fortmed] SMS accepted by provider.', {
    endpoint: activeEndpoint,
    toNumber: maskPhoneNumber(smsRecipient),
    status: response.status,
  });

  return {
    skipped: false,
    provider: 'fortmed',
    sid:
      (typeof responseBody === 'object' && responseBody !== null
        ? responseBody.sid ??
          responseBody.messageId ??
          responseBody.referenceId ??
          responseBody.Result ??
          null
        : null),
    to: smsRecipient,
    meta:
      typeof responseBody === 'object' && responseBody !== null
        ? {
            accepted: true,
            maskedRecipient: maskPhoneNumber(smsRecipient),
          }
        : undefined,
  };
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

  const smsRecipient = toFmcsmsMobileNumber(phoneNumber);

  if (!smsRecipient.startsWith('639') || smsRecipient.length !== 12) {
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
    console.warn('[SMS] SMS send skipped because SMS_ENABLED is false.');

    return {
      skipped: true,
      reason: 'disabled',
    };
  }

  console.log('[SMS] Dispatch requested.', {
    provider: env.smsProvider,
    fortmedConfigured: isFortmedConfigured(),
    fmcsmsConfigured: isFmcsmsConfigured(),
    twilioConfigured: isTwilioConfigured(),
    toNumber: maskPhoneNumber(toPhilippineE164(phoneNumber)),
  });

  if (env.smsProvider === 'fortmed') {
    return sendPreparationCompletionSmsViaFortmed({
      customerName,
      phoneNumber,
      vehicleLabel,
    });
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
