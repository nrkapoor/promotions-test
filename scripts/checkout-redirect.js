export function redirectNewGuestCheckout() {
  const { pathname, search, hostname } = window.location;
  if (!/\/checkout\/?$/.test(pathname) || !document.querySelector('main .commerce-checkout')
    || hostname.includes('ue.da.live') || new URLSearchParams(search).has('dapreview')) return false;

  // Keep this entry independent of the Commerce module graph so empty guests redirect first.
  const hasCookie = (name) => document.cookie.split(';').some((part) => {
    const cookie = part.trim();
    return cookie.startsWith(`${name}=`) && cookie.length > name.length + 1;
  });
  if (hasCookie('DROPIN__CART__CART-ID') || hasCookie('auth_dropin_user_token')
    || sessionStorage.getItem('DROPINS_CART_ID')
    || sessionStorage.getItem('DROPIN__CART__CART__DATA')
    || localStorage.getItem('DROPIN__CART__CART__AUTHENTICATED') === 'true') return false;

  window.location.href = pathname.replace(/\/checkout\/?$/, '/cart');
  return true;
}
