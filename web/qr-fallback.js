(function () {
  'use strict';

  // TODO: Set these when real App Store/TestFlight and Google Play links exist.
  const IOS_INSTALL_URL = '';
  const ANDROID_INSTALL_URL = '';
  const APP_HOST = 'app.bitestar.app';

  const fallbackCopy = {
    couponRestaurant: {
      title: 'Open this BiteSaver restaurant page',
      message: 'See restaurant coupons and specials in the BiteSaver app.',
    },
    biteScoreRestaurant: {
      title: 'Open this BiteScore restaurant page',
      message: 'See dish ratings and restaurant details in the BiteScore app.',
    },
    couponInvite: {
      title: 'Open your BiteSaver restaurant invite',
      message: 'Finish setting up your restaurant account securely in the app.',
    },
    biteScoreInvite: {
      title: 'Open your BiteScore restaurant claim invite',
      message: 'Claim this restaurant securely in the app after verifying your email.',
    },
    generic: {
      title: 'Open this BiteStar link in the app',
      message: 'Install BiteStar, or open the app if it is already on this device.',
    },
  };

  function detectLinkType(pathname) {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0] === 'r' && parts[1] === 'coupons') {
      return 'couponRestaurant';
    }
    if (parts.length >= 3 && parts[0] === 'r' && parts[1] === 'bitescore') {
      return 'biteScoreRestaurant';
    }
    if (parts.length >= 3 && parts[0] === 'invite' && parts[1] === 'coupon') {
      return 'couponInvite';
    }
    if (parts.length >= 3 && parts[0] === 'invite' && parts[1] === 'bitescore') {
      return 'biteScoreInvite';
    }
    return 'generic';
  }

  function configureInstallLink(elementId, url) {
    const element = document.getElementById(elementId);
    if (!element || !url) {
      return;
    }

    element.href = url;
    element.classList.remove('button-disabled');
    element.removeAttribute('aria-disabled');
    element.removeAttribute('tabindex');
  }

  function configureOpenAppLink() {
    const openAppLink = document.getElementById('open-app-link');
    if (!openAppLink) {
      return;
    }

    const pathAndQuery = window.location.pathname + window.location.search;
    const url = new URL(pathAndQuery || '/', 'https://' + APP_HOST);
    openAppLink.href = url.toString();
  }

  function applyCopy() {
    const type = detectLinkType(window.location.pathname);
    const copy = fallbackCopy[type] || fallbackCopy.generic;
    const title = document.getElementById('fallback-title');
    const message = document.getElementById('fallback-message');

    if (title) {
      title.textContent = copy.title;
      document.title = copy.title;
    }
    if (message) {
      message.textContent = copy.message;
    }
  }

  configureOpenAppLink();
  configureInstallLink('ios-install-link', IOS_INSTALL_URL);
  configureInstallLink('android-install-link', ANDROID_INSTALL_URL);
  applyCopy();
}());
