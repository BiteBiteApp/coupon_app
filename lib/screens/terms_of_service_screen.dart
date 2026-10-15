import 'package:flutter/material.dart';

import '../widgets/draft_legal_page.dart';

class TermsOfServiceScreen extends StatelessWidget {
  const TermsOfServiceScreen({super.key});

  @override
  Widget build(BuildContext context) => const DraftLegalPage(
    title: "BiteStar Terms of Service",
    children: [
      LegalParagraph(
        "Welcome to BiteStar, a service owned and operated by ColeSmart LLC.",
      ),
      LegalParagraph(
        "These Terms explain the rules and conditions for accessing and using BiteStar.",
      ),
      LegalParagraph(
        "The final Terms will become effective when approved and published, with any required acceptance or notice.",
      ),
      LegalSectionHeading("About BiteStar"),
      LegalParagraph("BiteStar offers two complementary ways to explore food."),
      LegalParagraph(
        "Coupons & Specials helps users discover restaurant offers, Daily Specials, menus, and other restaurant information.",
      ),
      LegalParagraph(
        "Dish Ratings lets users discover, rate, and review individual menu items.",
      ),
      LegalParagraph("Rate the dish. Not the restaurant."),
      LegalParagraph(
        "BiteStar's dish-rating system focuses on individual food items rather than relying solely on an overall restaurant rating.",
      ),
      LegalSectionHeading("Accounts and Age Requirements"),
      LegalParagraph(
        "Some BiteStar features are available without creating a registered account. Other features require registration, verification, or appropriate authorization.",
      ),
      LegalParagraph(
        "Account holders must provide accurate information, safeguard their credentials, and refrain from impersonating others.",
      ),
      LegalParagraph(
        "Users must be at least 13 years old, or meet a higher applicable legal minimum age, to create accounts or submit public contributions.",
      ),
      LegalParagraph(
        "Younger children may browse under parental supervision only where applicable privacy requirements and implemented safeguards permit.",
      ),
      LegalParagraph(
        "This is intended product policy; actual under-13 guest handling and account-age safeguards remain a separate pre-release qualification.",
      ),
      LegalSectionHeading("Reviews and Community Standards"),
      LegalParagraph(
        "BiteStar encourages genuine ratings, reviews, and opinions about individual dishes.",
      ),
      LegalParagraph(
        "Customers may praise good food, describe disappointment, and express criticism candidly.",
      ),
      LegalParagraph(
        "Occasional mild profanity or strong criticism does not automatically violate the community standards.",
      ),
      LegalParagraph("BiteStar does not permit:"),
      LegalBulletList([
        "Threats, harassment, bullying, or hateful or discriminatory attacks.",
        "Sexually explicit, exploitative, or excessively graphic content.",
        "Disclosure of another person's private information without authorization.",
        "Fraudulent ratings, fabricated reviews, impersonation, or deliberate manipulation of dish scores.",
        "Spam, scams, unlawful material, or other seriously abusive content.",
        "Copyright infringement or other unauthorized use of third-party material.",
      ]),
      LegalParagraph(
        "ColeSmart LLC may review, restrict, hide, or remove content when permitted or required by the service's rules and applicable law.",
      ),
      LegalParagraph(
        "Users may report reviews and other content through the reporting tools available in the app.",
      ),
      LegalSectionHeading("Ownership of Contributions"),
      LegalParagraph(
        "You retain ownership of original content you create, subject to the rights of others.",
      ),
      LegalParagraph(
        "By submitting content, you grant ColeSmart LLC a nonexclusive license to host, store, reproduce, display, and distribute that content as reasonably necessary to operate and promote the BiteStar service.",
      ),
      LegalParagraph(
        "This does not transfer ownership of your original photographs, reviews, or other original contributions to ColeSmart LLC.",
      ),
      LegalParagraph(
        "Content removal and account deletion remain subject to applicable processes, privacy rights, and law.",
      ),
      LegalSectionHeading("Restaurant Information and Offers"),
      LegalParagraph(
        "Restaurants and authorized contributors may submit information including menus, operating hours, photographs, coupons, and Daily Specials.",
      ),
      LegalParagraph(
        "Restaurant details, prices, menu items, and offers can change.",
      ),
      LegalParagraph(
        "Coupons and specials may have expiration dates, redemption rules, usage limitations, location conditions, or other stated restrictions.",
      ),
      LegalParagraph("Customers should review each offer's conditions."),
      LegalParagraph(
        "Participating restaurants are responsible for their applicable products, services, and valid offers, subject to law.",
      ),
      LegalParagraph(
        "ColeSmart LLC cannot guarantee that all third-party information remains accurate or that every listed item or offer remains available.",
      ),
      LegalSectionHeading("Restaurant-Owner Accounts"),
      LegalParagraph(
        "Restaurant owners and authorized representatives must have appropriate authority to act for the businesses they manage.",
      ),
      LegalParagraph(
        "Participation in subscription-based promotional features may require approval and an eligible subscription.",
      ),
      LegalParagraph(
        "Owners are responsible for maintaining accurate business information and honoring applicable offers.",
      ),
      LegalParagraph(
        "ColeSmart LLC may restrict promotional visibility or participation for legitimate operational, security, policy, or legal reasons.",
      ),
      LegalSectionHeading("Restaurant Subscriptions, Free Trials, and Billing"),
      LegalParagraph(
        "BiteStar's current restaurant subscription price is \$24.95 per month.",
      ),
      LegalParagraph(
        "Eligible first-time subscribers may receive a 60-day free trial.",
      ),
      LegalParagraph(
        "Unless canceled before the applicable trial ends, a subscription automatically converts to recurring monthly billing under the terms disclosed at checkout.",
      ),
      LegalParagraph(
        "Previous subscribers may not qualify for another free trial.",
      ),
      LegalParagraph("Subscription payments are processed through Stripe."),
      LegalParagraph(
        "Restaurant owners may cancel their subscriptions at any time through the available subscription-management process.",
      ),
      LegalParagraph(
        "For ordinary cancellations, service generally continues through the current paid billing period or free-trial period, as applicable.",
      ),
      LegalParagraph("There is no separate cancellation penalty."),
      LegalParagraph(
        "Payments are generally nonrefundable once a billing period begins, except where required by law.",
      ),
      LegalParagraph(
        "Billing mistakes, duplicate charges, or other exceptional circumstances may be reviewed, and refunds may be issued when appropriate.",
      ),
      LegalParagraph(
        "Ordinary cancellation does not automatically provide a prorated refund for unused subscription time.",
      ),
      LegalParagraph(
        "Permanent account deletion is a separate action. An accepted deletion request initiates immediate subscription cancellation, with confirmation potentially pending. Subscription-based content becomes unavailable, and deletion does not automatically issue a refund.",
      ),
      LegalParagraph(
        "Any rights provided by applicable consumer-protection law remain unaffected.",
      ),
      LegalParagraph(
        "Pricing changes will be disclosed, with notice or consent when required by applicable law.",
      ),
      LegalSectionHeading("Prohibited Uses"),
      LegalParagraph("Users must not:"),
      LegalBulletList([
        "Access another person's account without authorization.",
        "Manipulate reviews or ratings.",
        "Abuse coupon redemption or usage restrictions.",
        "Submit fraudulent ownership claims.",
        "Interfere with security systems or service operation.",
        "Harass others or use BiteStar for unlawful purposes.",
        "Systematically extract protected service information through unauthorized methods.",
      ]),
      LegalSectionHeading("Moderation and Account Restrictions"),
      LegalParagraph(
        "ColeSmart LLC may investigate reports, restrict content visibility, remove violating contributions, or limit participation when reasonably necessary and supported by applicable law and implemented service controls.",
      ),
      LegalParagraph(
        "Account deletion and removal of individual content are separate actions.",
      ),
      LegalSectionHeading("Third-Party Services"),
      LegalParagraph(
        "BiteStar may connect users to participating restaurants, payment services, app stores, or other independently operated third-party services.",
      ),
      LegalParagraph(
        "Those services may have their own terms and privacy policies.",
      ),
      LegalSectionHeading("Service Availability"),
      LegalParagraph(
        "We work to keep BiteStar reliable, but cannot guarantee uninterrupted service or error-free operation.",
      ),
      LegalParagraph(
        "Availability and functionality may be affected by maintenance, technical problems, security needs, or circumstances beyond our reasonable control.",
      ),
      LegalParagraph(
        "Nothing in these Terms excludes legal rights or remedies that cannot lawfully be excluded.",
      ),
      LegalSectionHeading("Intellectual Property"),
      LegalParagraph(
        "BiteStar's software, original designs, branding, and other materials owned by ColeSmart LLC are protected by applicable intellectual-property laws.",
      ),
      LegalParagraph(
        "Third-party names, trademarks, photographs, and other materials remain the property of their respective owners.",
      ),
      LegalSectionHeading("Changes to the Terms"),
      LegalParagraph("We may update the Terms as BiteStar develops."),
      LegalParagraph(
        "We will update the effective date and provide further notice or obtain consent when required by law.",
      ),
      LegalSectionHeading("Contact"),
      LegalParagraph("ColeSmart LLC"),
      LegalParagraph("contact@colesmartllc.com"),
      LegalParagraph("https://www.colesmartllc.com/"),
    ],
  );
}
