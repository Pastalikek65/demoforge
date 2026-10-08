const sensitiveQuerySuffixes = [
  'password',
  'passwd',
  'passcode',
  'pwd',
  'secret',
  'token',
  'credential',
  'credentials',
  'consumersecret',
  'sharedsecret',
  'secretaccesskey',
  'authorization',
  'auth',
  'session',
  'sessionid',
  'sid',
  'jwt',
  'signature',
  'sig',
  'authcode',
  'authorizationcode',
  'oauthcode',
  'cvv',
  'cvc',
  'cardnumber',
  'creditcard',
  'securitycode',
  'cardverificationvalue',
  'samlresponse',
] as const;

const sensitiveKeyNames = new Set([
  'code', // OAuth authorization-code callback parameter.
  'key',
  'apikey',
  'xapikey',
  'awsaccesskeyid',
  'privatekey',
  'signingkey',
  'encryptionkey',
  'accesskey',
]);

function normalizedParameterName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveUrlParameter(name: string): boolean {
  const normalized = normalizedParameterName(name);
  if (sensitiveKeyNames.has(normalized)) return true;
  return sensitiveQuerySuffixes.some((suffix) => normalized.endsWith(suffix));
}

export function hasSensitiveUrlQuery(value: string): boolean {
  try {
    const url = new URL(value);
    const fragment = url.hash.slice(1);
    const fragmentQuery = fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : fragment;
    for (const parameters of [url.searchParams, new URLSearchParams(fragmentQuery)]) {
      for (const name of parameters.keys()) {
        if (isSensitiveUrlParameter(name)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}
