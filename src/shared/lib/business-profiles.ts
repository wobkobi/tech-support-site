// src/shared/lib/business-profiles.ts
// The business's own third-party profiles, shared by the footer links and the
// LocalBusiness JSON-LD sameAs so the two never drift apart.

/**
 * Google Business Profile by its stable ?cid= URL, not the maps.app.goo.gl or
 * share.google links, which are redirects carrying tracking params.
 */
export const GOOGLE_BUSINESS_PROFILE_URL = "https://maps.google.com/?cid=6499301278416319650";

/** Business Facebook page (Harrison's personal profile lives on the About page's Person sameAs). */
export const FACEBOOK_PAGE_URL = "https://www.facebook.com/profile.php?id=61587338675655";
