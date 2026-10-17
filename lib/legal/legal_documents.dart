// One copy source for the existing in-app pages and generated static HTML.
// Finalized under the owner direction for BS-BITESTAR-LEGAL-FINAL-CLOSEOUT-001.
// Source approval does not publish these pages or activate acceptance.
enum LegalBlockKind { paragraph, heading, subheading, bullets, link }

class LegalBlock {
  final LegalBlockKind kind;
  final List<String> text;
  const LegalBlock(this.kind, this.text);
}

class LegalDocument {
  final String slug;
  final String title;
  final List<LegalBlock> blocks;
  const LegalDocument(this.slug, this.title, this.blocks);
}

const legalEffectiveDate = '2026-10-17';
const legalEffectiveDateLabel = 'Effective date: October 17, 2026.';
const legalTermsVersion = 'bitestar-terms-v1';
const legalPublicOrigin = 'https://app.colesmartllc.com';
// Legal source approval is separate from the dormant runtime acceptance policy.
const legalOwnerApproved = true;

List<String> legalMetadata(LegalDocument document) => [
  if (document.slug == 'terms-of-service') 'Terms version: $legalTermsVersion',
  legalEffectiveDateLabel,
];

const privacyPolicy = LegalDocument("privacy-policy", "BiteStar Privacy Policy", [
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar is owned and operated by ColeSmart LLC (\"ColeSmart,\" \"we,\" \"us,\" or \"our\").",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We respect your privacy. This Privacy Policy explains what information BiteStar collects, why we use it, when it may be shared, and what choices you have regarding your information.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Information We Collect"]),
  LegalBlock(LegalBlockKind.subheading, ["Account Information"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "When you create an account, we may collect your email address, phone number, username, display name, authentication information, and account preferences, depending on how you register or sign in.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "When Terms acceptance is enabled, we record the Terms version you accept and the acceptance time against your account. The same acceptance applies when that account uses customer and restaurant-owner features.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Certain publicly available features may be accessible without creating a registered account.",
  ]),
  LegalBlock(LegalBlockKind.subheading, [
    "Restaurant and Business Information",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Restaurant owners and authorized representatives may provide restaurant names, addresses, contact details, business hours, menus, photographs, coupons, Daily Specials, and other information needed to display and manage their restaurants.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We may maintain application status, ownership-verification information, subscription status, and related business records.",
  ]),
  LegalBlock(LegalBlockKind.subheading, ["Ratings, Reviews, and Photographs"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "When you participate in dish ratings, we may collect your ratings, written reviews, photographs, suggested edits, reports, and other contributions.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Some contributions may be publicly visible, along with your public display name, profile information, badges, or other permitted public contributions.",
  ]),
  LegalBlock(LegalBlockKind.subheading, ["Location Information"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar uses location information to help users discover restaurants, coupons, Daily Specials, and dishes.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "You may enter a city, ZIP code, or another supported search location.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar may save your last entered ZIP code or location preference on your device. Entered locations and permitted device coordinates may also be supplied to platform geocoding services. Features using server-based search send relevant location and search criteria to BiteStar's service providers.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "If you grant location permission, BiteStar may process device-location coordinates to provide nearby results or evaluate location-dependent features.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "You can manage location permissions through your device settings.",
  ]),
  LegalBlock(LegalBlockKind.subheading, ["Device and Technical Information"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We may process device or installation identifiers, app version, technical error information, security-verification signals, and information associated with coupon usage or other activity as needed to operate and protect BiteStar.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Certain preferences, saved activity, and feature-related information may be stored on your device.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Guest browsing does not require an age answer. Guest use can still involve local preferences and identifiers, network requests, and processing by the services described in this Policy. Where device-based coupon verification is enabled, platform security evidence and coupon-use identifiers are sent to BiteStar to enforce usage limits and prevent abuse.",
  ]),
  LegalBlock(LegalBlockKind.subheading, [
    "Subscription and Payment Information",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Restaurant-owner subscriptions are processed through the applicable payment provider, currently Stripe.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar may receive and retain subscription-status, transaction-reference, and billing-related information needed to manage service access, reconcile transactions, and fulfill legal obligations.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["How We Use Information"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We use information to operate restaurant discovery, coupons, Daily Specials, dish ratings and reviews; authenticate accounts; display permitted public contributions; manage restaurant-owner subscriptions; enforce coupon-use restrictions; provide support; prevent fraud and misuse; maintain reliability; and comply with applicable law.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We may send necessary account-verification, password-recovery, service, and support communications.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Public Contributions"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Dish ratings, reviews, photographs, public profiles, and other submitted content may be displayed to other users.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Please avoid posting private information about yourself or other people.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Reports and moderation decisions may affect whether particular contributions remain publicly visible.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Sharing Information"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "ColeSmart LLC does not sell personal information.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Information may be made available when necessary:",
  ]),
  LegalBlock(LegalBlockKind.bullets, [
    "To display contributions intentionally made public.",
    "To service providers supporting authentication, cloud hosting, data storage, technical operations, and subscription processing.",
    "To comply with applicable law or respond to lawful requests.",
    "To protect the service, investigate misuse, or address security issues.",
    "In connection with a legitimate business transition, subject to applicable legal requirements.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Service providers may include Google/Firebase for authentication, hosting, storage and service operations; Stripe for subscription payments; and Apple or Google platform services for location, geocoding and device-security verification where used.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "When written-review screening is enabled, BiteStar sends your submitted headline and written notes to OpenAI's Moderation service. We do not attach your account profile, email, payment information or photographs to that text-screening request; personal information you include in your own words is part of the submitted text.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "When photograph screening is enabled, BiteStar sends submitted customer and restaurant-owner photographs to Google Cloud Vision to help identify inappropriate content. Authorized BiteStar administrators may privately review held words and photographs. Screening does not guarantee detection of all inappropriate content.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Approval of a restaurant-owner photograph makes it available to the authorized owner; the owner must still attach or save it to publish it.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Your Choices"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Depending on the feature, you may update account information, manage location permissions, remove certain saved items, and request permanent account deletion.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "You may contact us regarding applicable privacy requests. Identity verification may be required.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Account Deletion and Data Retention"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "You may request permanent deletion through Delete Account in BiteStar or through the account-deletion page on the BiteStar website. The web process lets you sign in to your existing account and request deletion without installing the mobile app.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "For your security, we may require you to verify your identity before accepting the request.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Once accepted, BiteStar begins processing the removal of your personal account information and associated contributions, including applicable reviews, ratings, votes, photographs, and saved activity.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "If you operate a restaurant-owner account, its coupons, Daily Specials, and subscription-based promotional content become unavailable. BiteStar also initiates the applicable subscription-cancellation process. Cancellation may remain pending until confirmed, and deleting an account does not automatically result in a refund.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Certain shared restaurant information, dish catalog records, and contributions belonging to other users may remain. Deletion of your account does not automatically remove independently maintained restaurant or dish listings.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "After account deletion, certain limited records may be retained when reasonably necessary for security, fraud prevention, enforcing coupon-usage restrictions, financial recordkeeping, legal obligations, and documenting deletion requests. These may include device-identification and anti-abuse information, coupon-use restriction records, transaction references, and deletion-processing records.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Information may also remain temporarily in service-provider backup or recovery systems. Retention periods vary by record type and purpose. Expiration of a session, security challenge, or other logical retention period does not necessarily result in immediate physical erasure.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We retain information only as long as reasonably necessary for its applicable purposes or as otherwise required by law.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Deletion processing may continue after you close the app. Where available, you can check the status of your request through the account-deletion process.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "When screening and its retention controls are enabled, unpublished review words awaiting human review expire 30 consecutive 24-hour days after their original submission. Words whose screening cannot complete have a seven-day window for an explicit retry. A successful retry that still needs human review uses the original 30-day deadline.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Unpublished photographs awaiting review, including approved restaurant-owner photographs not yet attached, expire 30 consecutive 24-hour days after original submission. Uploaded photographs whose screening fails have a seven-day window for an explicit retry. Retries do not restart these clocks.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Expired submissions cannot be newly published. Rejected unpublished words are promptly removed from the current private proposal; rejected unpublished photographs are scheduled for prompt deletion. Physical cleanup is asynchronous and may take additional time, including during service interruptions.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "These screening windows do not set retention periods for published content, business or financial records, backups, or minimal moderation, security and deletion-status records. Limited identifiers, content digests, status and timing records may remain to prevent duplicate processing or stale publication and support moderation and deletion handling. Their retention depends on those purposes and applicable legal requirements; the screening windows are not a promise to erase all such records within 30 or seven days.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Security"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We use technical and organizational safeguards intended to protect information. However, no internet-based service or storage system can be guaranteed completely secure.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Children and Parental Guidance"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar is a general-audience food-discovery service, not an app specifically designed for children.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Users must be at least 13 years old, or satisfy any higher minimum age required by applicable law, to create accounts or submit public contributions.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Where BiteStar presents an age question, the answer is evaluated locally to decide whether registration can continue. This is self-reported age, not independent age verification. The entered age is cleared rather than stored or sent to our servers; no date of birth or persistent eligibility record is retained by this check.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Guest browsing does not establish a visitor's age or parental consent. Parents and guardians should consider the public content and data practices described in this Policy when supervising children.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Public reviews may contain language or opinions that parents consider inappropriate for younger visitors.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "If you believe a child has provided personal information contrary to applicable requirements, contact us so we can review the situation and take appropriate action under applicable law.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Your Privacy Rights"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Depending on your location, applicable law may give you rights to request access to, correction of, or deletion of certain personal information, along with other privacy choices.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We may need to verify your identity before acting on protected requests.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Changes to This Policy"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We may update this Privacy Policy as BiteStar evolves or legal requirements change.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We will update the effective date and provide additional notice when required by applicable law.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Contact"]),
  LegalBlock(LegalBlockKind.paragraph, ["ColeSmart LLC"]),
  LegalBlock(LegalBlockKind.paragraph, ["contact@colesmartllc.com"]),
  LegalBlock(LegalBlockKind.paragraph, ["https://app.colesmartllc.com/"]),
]);

const termsOfService = LegalDocument("terms-of-service", "BiteStar Terms of Service", [
  LegalBlock(LegalBlockKind.paragraph, [
    "Welcome to BiteStar, a service owned and operated by ColeSmart LLC.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "These Terms explain the rules and conditions for accessing and using BiteStar. They cover customers, restaurant owners and authorized contributors, including contributors to shared menus.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "These Terms take effect on the effective date shown with the published version, with any required acceptance or notice.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["About BiteStar"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar offers two complementary ways to explore food.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Coupons & Specials helps users discover restaurant offers, Daily Specials, menus, and other restaurant information.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Dish Ratings lets users discover, rate, and review individual menu items.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, ["Rate the dish. Not the restaurant."]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar's dish-rating system focuses on individual food items rather than relying solely on an overall restaurant rating.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Accounts and Age Requirements"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Some BiteStar features are available without creating a registered account. Other features require registration, verification, or appropriate authorization.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Account holders must provide accurate information, safeguard their credentials, and refrain from impersonating others.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Users must be at least 13 years old, or meet a higher applicable legal minimum age, to create accounts or submit public contributions.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Guest browsing does not require an age answer. Where an age question is presented for registration, it uses self-reported age rather than independent verification. Guest access does not establish age or parental consent; parents and guardians should consider the public content and data practices described in the Privacy Policy.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "When required acceptance is enabled, you must accept the current applicable Terms before creating or substantively changing public contributions, including customer reviews and photographs and restaurant-owner profiles, offers, specials and menus. One acceptance applies to the same account across customer and owner roles. A new mandatory version requires renewed acceptance.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Acceptance does not grant restaurant ownership, approval, subscription access or other publishing permissions. Browsing, reporting, blocking, permitted withdrawal or deletion, and legitimate account or subscription management remain subject to their separate processes.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Reviews and Community Standards"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar encourages genuine ratings, reviews, and opinions about individual dishes.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Customers may praise good food, describe disappointment, and express criticism candidly.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Occasional mild profanity or strong criticism does not automatically violate the community standards.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, ["BiteStar does not permit:"]),
  LegalBlock(LegalBlockKind.bullets, [
    "Threats, harassment, bullying, or hateful or discriminatory attacks.",
    "Sexually explicit, exploitative, or excessively graphic content.",
    "Disclosure of another person's private information without authorization.",
    "Fraudulent ratings, fabricated reviews, impersonation, or deliberate manipulation of dish scores.",
    "Spam, scams, unlawful material, or other seriously abusive content.",
    "Copyright infringement or other unauthorized use of third-party material.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "ColeSmart LLC may review, restrict, hide, or remove content when permitted or required by the service's rules and applicable law.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Use Report Review or Report Photo where available to report inappropriate content. Where Block Reviewer is available, it hides that reviewer's reviews from your browsing; you can manage blocked reviewers in My Profile.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Ownership of Contributions"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "You retain ownership of original content you create, subject to the rights of others.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "By submitting content, you grant ColeSmart LLC a nonexclusive license to host, store, reproduce, display, and distribute that content as reasonably necessary to operate and promote the BiteStar service.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "This does not transfer ownership of your original photographs, reviews, or other original contributions to ColeSmart LLC.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Content removal and account deletion remain subject to applicable processes, privacy rights, and law.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Restaurant Information and Offers"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Restaurants and authorized contributors may submit information including menus, operating hours, photographs, coupons, and Daily Specials.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Restaurant details, prices, menu items, and offers can change.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Coupons and specials may have expiration dates, redemption rules, usage limitations, location conditions, or other stated restrictions.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Customers should review each offer's conditions.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Participating restaurants are responsible for their applicable products, services, and valid offers, subject to law.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "ColeSmart LLC cannot guarantee that all third-party information remains accurate or that every listed item or offer remains available.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Restaurant-Owner Accounts"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Restaurant owners and authorized representatives must have appropriate authority to act for the businesses they manage.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Participation in subscription-based promotional features may require approval and an eligible subscription.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Owners are responsible for maintaining accurate business information and honoring applicable offers.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "ColeSmart LLC may restrict promotional visibility or participation for legitimate operational, security, policy, or legal reasons.",
  ]),
  LegalBlock(LegalBlockKind.heading, [
    "Restaurant Subscriptions, Free Trials, and Billing",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar's current restaurant subscription price is \$24.95 per month.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Eligible first-time subscribers may receive a 60-day free trial.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Unless canceled before the applicable trial ends, a subscription automatically converts to recurring monthly billing under the terms disclosed at checkout.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Previous subscribers may not qualify for another free trial.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Subscription payments are processed through Stripe.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Restaurant owners may cancel their subscriptions at any time through the available subscription-management process.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "For ordinary cancellations, service generally continues through the current paid billing period or free-trial period, as applicable.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "There is no separate cancellation penalty.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Payments are generally nonrefundable once a billing period begins, except where required by law.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Billing mistakes, duplicate charges, or other exceptional circumstances may be reviewed, and refunds may be issued when appropriate.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Ordinary cancellation does not automatically provide a prorated refund for unused subscription time.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Permanent account deletion is a separate action. An accepted deletion request initiates immediate subscription cancellation, with confirmation potentially pending. Subscription-based content becomes unavailable, and deletion does not automatically issue a refund.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Any rights provided by applicable consumer-protection law remain unaffected.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Pricing changes will be disclosed, with notice or consent when required by applicable law.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Prohibited Uses"]),
  LegalBlock(LegalBlockKind.paragraph, ["Users must not:"]),
  LegalBlock(LegalBlockKind.bullets, [
    "Access another person's account without authorization.",
    "Manipulate reviews or ratings.",
    "Abuse coupon redemption or usage restrictions.",
    "Submit fraudulent ownership claims.",
    "Interfere with security systems or service operation.",
    "Harass others or use BiteStar for unlawful purposes.",
    "Systematically extract protected service information through unauthorized methods.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Moderation and Account Restrictions"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "ColeSmart LLC may investigate reports, restrict content visibility, remove violating contributions, or limit participation when reasonably necessary and supported by applicable law and implemented service controls.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "When enabled, written-review screening uses OpenAI and photograph screening uses Google Cloud Vision, with private review by authorized BiteStar administrators where needed, as described in the Privacy Policy. A screening flag is not proof of misconduct and does not automatically suspend an account. Screening is not a guarantee that all inappropriate content will be detected.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Account deletion and removal of individual content are separate actions.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Third-Party Services"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar may connect users to participating restaurants, payment services, app stores, or other independently operated third-party services.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Those services may have their own terms and privacy policies.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Service Availability"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We work to keep BiteStar reliable, but cannot guarantee uninterrupted service or error-free operation.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Availability and functionality may be affected by maintenance, technical problems, security needs, or circumstances beyond our reasonable control.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Nothing in these Terms excludes legal rights or remedies that cannot lawfully be excluded.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Intellectual Property"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar's software, original designs, branding, and other materials owned by ColeSmart LLC are protected by applicable intellectual-property laws.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Third-party names, trademarks, photographs, and other materials remain the property of their respective owners.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Governing Law and Disputes"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "BiteStar is owned and operated by ColeSmart LLC, a Florida limited liability company.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "These Terms are governed by the laws of the State of Florida, United States, except where applicable law requires otherwise.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Disputes arising from the use of BiteStar may be brought before a court of competent jurisdiction, subject to applicable law.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "Nothing in these Terms limits any consumer rights or legal remedies that cannot lawfully be waived.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Changes to the Terms"]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We may update the Terms as BiteStar develops.",
  ]),
  LegalBlock(LegalBlockKind.paragraph, [
    "We will update the effective date and provide further notice or obtain consent when required by law.",
  ]),
  LegalBlock(LegalBlockKind.heading, ["Contact"]),
  LegalBlock(LegalBlockKind.paragraph, ["ColeSmart LLC"]),
  LegalBlock(LegalBlockKind.paragraph, ["contact@colesmartllc.com"]),
  LegalBlock(LegalBlockKind.paragraph, ["https://app.colesmartllc.com/"]),
]);

const accountDeletionInformation = LegalDocument(
  "delete-account",
  "BiteStar Account Deletion",
  [
    LegalBlock(LegalBlockKind.paragraph, [
      "BiteStar is owned and operated by ColeSmart LLC. This page explains how to request permanent account deletion and what happens to your information.",
    ]),
    LegalBlock(LegalBlockKind.heading, [
      "Request deletion without installing the app",
    ]),
    LegalBlock(LegalBlockKind.paragraph, [
      "Open the secure BiteStar account-deletion screen in your browser. Sign in to your existing account, choose Delete Account, and complete the identity verification and confirmation shown there. You do not need the mobile app. Opening this information page does not sign you in or submit a deletion request.",
    ]),
    LegalBlock(LegalBlockKind.link, [
      "Open secure account deletion",
      "/#/account/delete",
    ]),
    LegalBlock(LegalBlockKind.paragraph, [
      "In the app, use Delete Account from the account controls. Uninstalling BiteStar does not delete your account.",
    ]),
    LegalBlock(LegalBlockKind.heading, ["Identity verification"]),
    LegalBlock(LegalBlockKind.paragraph, [
      "Use the secure browser process above to request deletion. You must verify that you control the account before deletion can be authorized. An email address alone is not deletion authority.",
    ]),
    LegalBlock(LegalBlockKind.paragraph, [
      "Do not send passwords, sign-in codes, payment-card details or identity documents by email.",
    ]),
    LegalBlock(LegalBlockKind.heading, ["What is deleted or made unavailable"]),
    LegalBlock(LegalBlockKind.paragraph, [
      "Once your request is securely accepted, BiteStar begins removing personal account information and associated reviews, ratings, votes, photographs and saved activity. Restaurant-owner promotional content becomes unavailable, and the applicable subscription-cancellation process begins. Confirmation can remain pending; deletion does not automatically issue a refund.",
    ]),
    LegalBlock(LegalBlockKind.heading, ["What may remain"]),
    LegalBlock(LegalBlockKind.paragraph, [
      "Independently maintained restaurant and dish catalog information and other people's contributions may remain. Limited security, fraud-prevention, coupon-use, financial and deletion-processing records may be retained for their applicable purposes or legal obligations. Provider backups and recovery systems may retain information temporarily. The private screening windows in the Privacy Policy do not apply to all of these records.",
    ]),
    LegalBlock(LegalBlockKind.heading, ["Timing and confirmation"]),
    LegalBlock(LegalBlockKind.paragraph, [
      "Processing may continue after you close the app or browser and is not instantaneous. Keep the browser or app's saved deletion receipt to check status after sign-out. Clearing local data can remove that receipt. A pending status is not confirmation that deletion is complete.",
    ]),
    LegalBlock(LegalBlockKind.heading, ["Contact"]),
    LegalBlock(LegalBlockKind.paragraph, ["ColeSmart LLC"]),
    LegalBlock(LegalBlockKind.paragraph, ["contact@colesmartllc.com"]),
    LegalBlock(LegalBlockKind.paragraph, ["https://app.colesmartllc.com/"]),
  ],
);

const legalDocuments = [
  privacyPolicy,
  termsOfService,
  accountDeletionInformation,
];
