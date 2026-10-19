/** Only publish real store/test links supplied at build time. Fail closed on invalid config. */
export function mobileDownload(
  platform: 'ios' | 'android',
  address?: string,
): { url: string; beta: boolean } | null {
  if (!address?.trim()) return null;
  try {
    const url = new URL(address.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (platform === 'ios') {
      if (
        url.hostname === 'apps.apple.com' &&
        /\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id\d+\/?$/.test(url.pathname)
      )
        return { url: url.href, beta: false };
      if (url.hostname === 'testflight.apple.com' && /^\/join\/[A-Za-z0-9]+\/?$/.test(url.pathname))
        return { url: url.href, beta: true };
    } else if (url.hostname === 'play.google.com') {
      if (
        url.pathname === '/store/apps/details' &&
        url.searchParams.get('id') === 'com.bullebrowser.mobile'
      )
        return { url: url.href, beta: false };
      if (url.pathname === '/apps/testing/com.bullebrowser.mobile')
        return { url: url.href, beta: true };
    }
    return null;
  } catch {
    return null;
  }
}
