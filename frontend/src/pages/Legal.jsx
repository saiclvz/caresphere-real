import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { PublicFooter, PublicNav } from './PublicChrome';
import { RA11642_URL } from '../lib/laws';

const UPDATED = 'October 2026';
const RA10173_URL = 'https://privacy.gov.ph/data-privacy-act/';

/** The home's public contact details (Settings > Organisation and Data Protection Officer). */
export function usePublicContact() {
  const [c, setC] = useState(null);
  useEffect(() => { api('/public/contact').then((r) => setC(r.data)).catch(() => setC({})); }, []);
  return c;
}

/** Copyright-only footer (kept for compatibility; the public pages use PublicFooter from PublicChrome). */
export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200/70 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-600 sm:px-6">© 2026 CareSphere</div>
    </footer>
  );
}

function LegalShell({ title, children, updatedLabel = 'Last updated' }) {
  return (
    <div className="cs-home public-page">
      <a href="#legal-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-modal">Skip to main content</a>
      <PublicNav />
      <main id="legal-main">
        <div className="public-container py-10">
          <div className="mx-auto max-w-4xl">
            <div className="relative overflow-hidden rounded-2xl border border-brand-200/70 bg-brand-100 px-6 pb-5 pt-6 sm:px-8">
              <p className="mb-1.5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-brand"><span aria-hidden className="h-px w-8 shrink-0 bg-brand" />Legal</p>
              <h1 className="font-display text-3xl font-bold text-navy-900">{title}</h1>
              <p className="mt-1 text-sm text-slate-600">{updatedLabel}: {UPDATED}</p>
              <p className="mt-2 text-xs font-medium text-navy-800">Draft: to be reviewed by the home's legal adviser and Data Protection Officer.</p>
            </div>
            <div className="legal-body mt-6 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 text-[0.9375rem] leading-relaxed text-slate-700 shadow-card sm:p-8">
              {children}
            </div>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}

function Contact({ c }) {
  if (!c) return null;
  const org = c.org_name || 'CareSphere';
  return (
    <ul>
      <li>{org}{c.org_address ? `, ${c.org_address}` : ''}{c.org_contact ? ` · ${c.org_contact}` : ''}</li>
      {(c.dpo_name || c.dpo_email || c.dpo_phone) && <li>Data Protection Officer: {[c.dpo_name, c.dpo_email, c.dpo_phone].filter(Boolean).join(' · ')}</li>}
      {!c.org_contact && !c.dpo_email && !c.dpo_phone && <li>Ask the home's office for the Data Protection Officer's contact details.</li>}
    </ul>
  );
}

/** /privacy - how CareSphere handles personal information (RA 10173, Data Privacy Act of 2012). */
export function PrivacyPolicy() {
  const c = usePublicContact();
  const ext = 'font-medium text-brand underline';
  return (
    <LegalShell title="Privacy Policy">
      <section><h2>1. Who we are</h2>
        <p>CareSphere is the records system of {c?.org_name || 'the children\'s home'} (the "home"). The home is the personal information controller for the information kept in CareSphere and processes it under the <a className={ext} href={RA10173_URL} target="_blank" rel="noopener noreferrer">Data Privacy Act of 2012 (RA 10173)</a>, its implementing rules and the issuances of the National Privacy Commission.</p></section>
      <section><h2>2. What we collect</h2>
        <ul>
          <li>Account information: name, email address, role and sign-in records.</li>
          <li>Donor information: contact details, donations, and what you report about a donation you sent (the account you sent it to, amount, transfer reference number, date and time, optional sender name or last 4 digits, note and optional proof), and acknowledgments. CareSphere doesn't receive, hold or process payments, and never asks for card details, passwords or one-time PINs.</li>
          <li>Adoption applicant information: the details and documents required for administrative adoption under <a className={ext} href={RA11642_URL} target="_blank" rel="noopener noreferrer">RA 11642</a>.</li>
          <li>Children's records: admission, care, health, adoption and transition information, kept by the home's staff.</li>
          <li>Visitor logs and security records, such as access logs and the audit trail.</li>
        </ul></section>
      <section><h2>3. Why we use it</h2>
        <p>To care for the children in the home, to run the home's programs, to check donations you report against the home's own bank or e-wallet account and to acknowledge them, to process adoption applications as the law requires, to keep the records safe, and to meet our legal obligations. We do not sell personal information or use it for advertising.</p></section>
      <section><h2>4. Who can see it</h2>
        <p>Only authorized staff, for their work. Sensitive records (health, adoption and transition) open only for the assigned staff member after a stated purpose and a QR check, and every view is logged. Adoption records are confidential under RA 11642 Section 39. Information is shared outside the home only when the law requires it (for example with the DSWD, the National Authority for Child Care or the courts) or with your consent.</p></section>
      <section><h2>5. How we protect it</h2>
        <p>Records run on the home's own network. Sensitive fields and uploaded files are encrypted, access depends on role, duty and assignment, administrators use two-step verification, and an audit log records who opened or changed what.</p></section>
      <section><h2>6. How long we keep it</h2>
        <p>As long as needed for the purpose and as required by law. Children's and adoption records are kept as the law and the home's retention rules require; other records are disposed of securely when no longer needed.</p></section>
      <section><h2>7. Your rights</h2>
        <p>Under RA 10173 you may ask to be informed, to access your information, to correct it, to object, to have it erased or blocked when allowed, and to receive a copy. Signed-in users can send a request from their account; you may also contact the Data Protection Officer below. You may file a complaint with the National Privacy Commission.</p></section>
      <section><h2>8. Contact</h2><Contact c={c} /></section>
      <section><h2>9. Changes</h2><p>We will post any change to this policy on this page with a new "Last updated" date.</p></section>
    </LegalShell>
  );
}

/**
 * /terms - Terms and Conditions (public, no sign-in). The text is the home's own Terms (October 2026). The contact
 * details come from Settings (Organization and Data Protection Officer) when they are filled in; otherwise the
 * details given with these Terms are shown.
 */
export function Terms() {
  const c = usePublicContact() || {};
  const org = 'CareSphere Child Welfare Home';
  const P = ({ children }) => <p>{children}</p>;
  return (
    <LegalShell title="Terms and Conditions" updatedLabel="Last Updated">
      <section>
        <P>These Terms and Conditions (&ldquo;Terms&rdquo;) govern your access to and use of the CareSphere website and its related online services (collectively, the &ldquo;Website&rdquo;), operated for CareSphere Child Welfare Home (&ldquo;CareSphere,&rdquo; &ldquo;the Organization,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).</P>
        <P>By accessing or using the Website, creating an account, submitting information, making a donation, or using any service made available through the Website, you acknowledge that you have read, understood, and agreed to be bound by these Terms.</P>
        <P>If you do not agree to these Terms, you must not access or use the Website.</P>
      </section>

      <section><h2>1. Scope of the Website</h2>
        <P>CareSphere provides an online platform intended to support the activities and services of CareSphere Child Welfare Home, including, where applicable, information concerning the Organization, donation services, adoption-related applications, account services, and other authorized functions made available through the Website.</P>
        <P>The availability of particular services, features, or functions may depend upon the user&rsquo;s account type, authorization, eligibility, and applicable organizational requirements.</P>
        <P>The Organization reserves the right to modify, suspend, restrict, or discontinue any portion of the Website or any service made available through it, subject to applicable law.</P>
      </section>

      <section><h2>2. Eligibility and Use of the Website</h2>
        <P>You agree to use the Website only for lawful purposes and in accordance with these Terms.</P>
        <P>You shall not use the Website in any manner that:</P>
        <ol>
          <li>violates any applicable law, regulation, or government requirement;</li>
          <li>infringes upon the rights of another person or entity;</li>
          <li>involves fraud, deception, misrepresentation, or unauthorized activity;</li>
          <li>attempts to gain unauthorized access to accounts, systems, records, or information;</li>
          <li>interferes with or disrupts the operation or security of the Website;</li>
          <li>introduces malicious software, harmful code, or other material capable of compromising the Website;</li>
          <li>collects, copies, extracts, or uses information obtained through the Website for an unauthorized purpose; or</li>
          <li>otherwise misuses the Website or any service provided through it.</li>
        </ol>
        <P>The Organization reserves the right to restrict or terminate access where there are reasonable grounds to believe that a user has violated these Terms or applicable law.</P>
      </section>

      <section><h2>3. User Accounts</h2>
        <P>Certain features of the Website may require the creation or use of an account.</P>
        <P>Where an account is required, you agree to provide information that is accurate, complete, and current and to maintain the confidentiality of your account credentials.</P>
        <P>You are responsible for activities conducted through your account, subject to applicable law.</P>
        <P>You must promptly notify CareSphere if you become aware of unauthorized access to your account or have reason to believe that your credentials have been compromised.</P>
        <P>CareSphere may suspend, deactivate, or terminate an account where reasonably necessary for security, administrative, legal, or operational purposes.</P>
        <P>Staff and administrator accounts may be established and managed by the Organization and may be subject to additional access requirements and internal policies.</P>
      </section>

      <section><h2>4. Information Submitted Through the Website</h2>
        <P>You are responsible for ensuring that information you submit through the Website is accurate, complete, and not misleading.</P>
        <P>You shall not knowingly submit information that is false, fraudulent, materially misleading, or intended to improperly obtain a benefit, service, approval, or access.</P>
        <P>The Organization may request additional information or documentation where reasonably necessary to verify information submitted through the Website or to process a particular request or application.</P>
        <P>The submission of information does not, by itself, constitute approval, acceptance, eligibility, entitlement, or confirmation unless expressly stated by the Organization.</P>
      </section>

      <section><h2>5. Donations</h2>
        <P>The Website may provide functionality allowing users to make monetary or in-kind donations to CareSphere Child Welfare Home.</P>
        <P>Unless expressly designated and accepted for a specific purpose, donations may be used by the Organization for its programs, services, operations, child welfare activities, and other lawful organizational purposes.</P>
        <P>Donation information may be recorded and retained for purposes including verification, accounting, acknowledgment, reporting, audit, and financial administration.</P>
        <P>CareSphere does not receive, hold, or process payments. Monetary donations are sent by the donor, outside the Website, through the donor&rsquo;s own bank or e-wallet application to the Organization&rsquo;s account shown on the Website. The donor&rsquo;s bank or e-wallet provider may impose its own terms, conditions, fees, and requirements.</P>
        <P>A donation reported through the Website is recorded as a donation only after the Organization confirms that it was received in its own account. Until then it is shown as waiting for confirmation and is not acknowledged. Before sending, donors should check that the recipient name shown in their application matches the account name displayed on the Website.</P>
        <P>The Organization shall not be responsible for a transfer sent to an account other than the one displayed on the Website, or for a failure attributable solely to a bank, e-wallet provider, financial institution, telecommunications provider, or other external service beyond the Organization&rsquo;s reasonable control.</P>
      </section>

      <section><h2>6. Adoption Applications</h2>
        <P>The Website may provide functionality for submitting information or applications relating to adoption.</P>
        <P>Adoption-related applications are subject to applicable Philippine laws, regulations, administrative requirements, and procedures governing adoption and alternative child care, including Republic Act No. 11642 and applicable requirements of the National Authority for Child Care (NACC).</P>
        <P>Submission of an adoption application through the Website does not constitute approval of the application and does not guarantee:</P>
        <ol>
          <li>eligibility to adopt;</li>
          <li>acceptance of the application;</li>
          <li>matching with a child;</li>
          <li>placement of a child;</li>
          <li>issuance of an adoption-related order or document; or</li>
          <li>completion of the adoption process.</li>
        </ol>
        <P>Applicants shall provide truthful, accurate, complete, and current information and documentation.</P>
        <P>The submission of false, fraudulent, materially misleading, or intentionally incomplete information may result in the rejection, suspension, or termination of an application and may be referred to the appropriate authority where required or permitted by law.</P>
        <P>Nothing contained on the Website shall be interpreted as replacing the formal legal or administrative requirements applicable to an adoption proceeding.</P>
      </section>

      <section><h2>7. Child and Case Information</h2>
        <P>The Website and related CareSphere services may contain confidential or sensitive information relating to children, families, applicants, employees, cases, health matters, adoption proceedings, and other child welfare activities.</P>
        <P>Such information is not intended for unrestricted public access.</P>
        <P>Users shall not attempt to obtain, reproduce, download, disclose, publish, or otherwise use confidential information for any purpose for which they are not authorized.</P>
        <P>Access to restricted information may be subject to account permissions, role-based authorization, assignment requirements, authentication procedures, and other security controls implemented by the Organization.</P>
        <P>Unauthorized access or use may result in suspension or termination of access and may be subject to applicable administrative or legal action.</P>
      </section>

      <section><h2>8. Privacy and Data Protection</h2>
        <P>CareSphere may collect and process personal information and, where applicable, sensitive personal information in connection with the operation of the Website and the delivery of its services.</P>
        <P>The Organization&rsquo;s collection, use, storage, disclosure, retention, and protection of personal information are governed by applicable Philippine data protection laws and the CareSphere <Link className="font-medium text-brand underline" to="/privacy">Privacy Policy</Link>.</P>
        <P>By using the Website, you acknowledge that personal information may be processed as described in the <Link className="font-medium text-brand underline" to="/privacy">Privacy Policy</Link> and for purposes permitted by applicable law.</P>
      </section>

      <section><h2>9. Intellectual Property</h2>
        <P>Unless otherwise stated, the Website and its contents, including its design, layout, text, graphics, logos, software, databases, and other materials, are owned by, licensed to, or otherwise lawfully used by CareSphere Child Welfare Home.</P>
        <P>Nothing in these Terms grants you ownership of or any proprietary interest in the Website or its contents.</P>
        <P>Except as expressly permitted by the Organization or applicable law, you shall not reproduce, modify, distribute, publicly display, commercially exploit, reverse engineer, or otherwise use protected Website content beyond the ordinary use of the Website.</P>
      </section>

      <section><h2>10. Third-Party Websites and Services</h2>
        <P>The Website may contain links to websites, payment services, applications, or other resources operated by third parties.</P>
        <P>Such links are provided for convenience and do not necessarily constitute an endorsement, representation, or warranty by CareSphere concerning the third-party service or its contents.</P>
        <P>Third-party websites and services are governed by their respective terms and privacy policies. CareSphere does not control and is not responsible for the content, availability, security, or practices of third-party services.</P>
      </section>

      <section><h2>11. Website Availability and Maintenance</h2>
        <P>The Organization will take reasonable measures to maintain the availability and functionality of the Website.</P>
        <P>However, the Organization does not warrant that the Website will be continuously available, uninterrupted, secure, timely, or free from errors or defects.</P>
        <P>The Website may become temporarily unavailable due to maintenance, updates, security measures, technical problems, network failures, third-party service interruptions, or circumstances beyond the reasonable control of the Organization.</P>
        <P>The Organization may conduct scheduled or unscheduled maintenance and may modify or temporarily suspend Website functionality where reasonably necessary.</P>
      </section>

      <section><h2>12. Accuracy of Information</h2>
        <P>The Organization endeavors to maintain accurate and current information on the Website. However, information may occasionally contain errors, omissions, or outdated material.</P>
        <P>The presence of information on the Website shall not, by itself, constitute a representation that such information is complete, current, or applicable to every individual circumstance.</P>
        <P>Where a matter requires an official determination, users should rely upon the applicable official communication, record, decision, or authorized representative of the Organization or the relevant government authority.</P>
      </section>

      <section><h2>13. Disclaimers</h2>
        <P>To the extent permitted by applicable law, the Website and its services are provided on an &ldquo;as available&rdquo; basis.</P>
        <P>CareSphere does not warrant that:</P>
        <ol>
          <li>the Website will operate without interruption;</li>
          <li>the Website will be completely free from errors or defects;</li>
          <li>all information displayed on the Website will always be current or complete; or</li>
          <li>the Website will satisfy every user&rsquo;s particular requirements.</li>
        </ol>
        <P>Nothing in these Terms excludes any right, protection, or obligation that cannot lawfully be excluded under Philippine law.</P>
      </section>

      <section><h2>14. Limitation of Liability</h2>
        <P>To the maximum extent permitted by applicable law, CareSphere Child Welfare Home shall not be liable for indirect, incidental, special, consequential, or similar losses arising from the use of, or inability to use, the Website where such losses result from circumstances beyond the reasonable control of the Organization.</P>
        <P>This includes, where applicable, interruptions caused by telecommunications providers, payment processors, hosting providers, internet service providers, or other third-party services.</P>
        <P>Nothing in these Terms shall exclude or limit liability where such exclusion or limitation is prohibited by applicable Philippine law.</P>
      </section>

      <section><h2>15. Suspension and Termination</h2>
        <P>The Organization may suspend or terminate access to the Website or specific services where reasonably necessary, including where:</P>
        <ol>
          <li>these Terms have been violated;</li>
          <li>unauthorized or fraudulent activity is suspected;</li>
          <li>continued access presents a security or privacy risk;</li>
          <li>information submitted by a user is determined to be materially false or fraudulent;</li>
          <li>access is no longer authorized; or</li>
          <li>suspension or termination is required by applicable law or organizational policy.</li>
        </ol>
        <P>Termination of access shall not affect any rights or obligations that accrued before termination or any provisions that by their nature are intended to survive termination.</P>
      </section>

      <section><h2>16. Indemnification</h2>
        <P>To the extent permitted by applicable law, a user who engages in unauthorized, unlawful, fraudulent, or prohibited conduct through the Website may be responsible for losses, claims, liabilities, damages, costs, or expenses arising from such conduct.</P>
        <P>Nothing in this section shall impose liability where such liability is prohibited by applicable law.</P>
      </section>

      <section><h2>17. Governing Law</h2>
        <P>These Terms shall be governed by and construed in accordance with the laws of the Republic of the Philippines.</P>
        <P>Any matter arising from or relating to these Terms or the use of the Website shall be subject to the applicable laws, rules, and procedures of the Republic of the Philippines.</P>
      </section>

      <section><h2>18. Changes to These Terms</h2>
        <P>CareSphere Child Welfare Home reserves the right to amend, revise, or update these Terms when reasonably necessary to reflect changes in the Website, services, organizational policies, legal requirements, or applicable regulations.</P>
        <P>The revised Terms shall be published on this page together with the corresponding Last Updated date.</P>
        <P>Users are responsible for reviewing the current version of these Terms when using the Website.</P>
        <P>Continued use of the Website after revised Terms have taken effect constitutes acceptance of the revised Terms, to the extent permitted by applicable law.</P>
      </section>

      <section><h2>19. Severability</h2>
        <P>If any provision of these Terms is determined to be invalid, unlawful, or unenforceable, such provision shall be enforced to the maximum extent permitted by law, and the remaining provisions shall remain valid and enforceable.</P>
      </section>

      <section><h2>20. Entire Agreement</h2>
        <P>These Terms, together with the CareSphere Privacy Policy and any other policies expressly incorporated by reference, constitute the terms governing your use of the Website, except where a separate written agreement or mandatory legal requirement provides otherwise.</P>
      </section>

      <section><h2>21. Contact Information</h2>
        <P>For questions, concerns, or notices relating to these Terms and Conditions, the Website, or the processing of personal information, you may contact:</P>
        <address className="mt-2 not-italic">
          <p className="font-medium text-navy-900">{org}</p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            <dt className="text-slate-500">Data Protection Officer:</dt><dd>{c.dpo_name || 'CareSphere Capstone'}</dd>
            <dt className="text-slate-500">Email:</dt><dd><a className="text-brand underline" href={`mailto:${c.dpo_email || 'capstonecaresphere@gmail.com'}`}>{c.dpo_email || 'capstonecaresphere@gmail.com'}</a></dd>
            <dt className="text-slate-500">Telephone:</dt><dd>{c.dpo_phone || '09989239681'}</dd>
          </dl>
        </address>
      </section>
    </LegalShell>
  );
}
