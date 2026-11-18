/**
 * Customer portal frame, styled to match the main Chequered Flag website
 * (thechequeredflag.net): white header with the flag logo, warm off-white page,
 * and a footer with the workshop's location, hours and contact details.
 */
const SITE = 'https://www.thechequeredflag.net';
const PHONE_DISPLAY = '+254 720 514965';
const PHONE_TEL = 'tel:+254720514965';
export const WHATSAPP = 'https://wa.me/254720514965';

/** WhatsApp link with a message already typed in (customer just presses send). */
export function whatsappWithText(text) {
  return `${WHATSAPP}?text=${encodeURIComponent(text)}`;
}
const MAPS = 'https://www.google.com/maps/search/?api=1&query=Chequered+Flag+Ngong+Road+Karen+Nairobi';

function Brand() {
  return (
    <a className="cf-brand" href={SITE} target="_blank" rel="noopener noreferrer">
      <span className="cf-brand-mark">
        <img src="/cf-flag.png" alt="" width="30" height="30" />
      </span>
      <span>
        <span className="cf-brand-name">Chequered Flag</span>
        <span className="cf-brand-est">Established 1975</span>
      </span>
    </a>
  );
}

export default function PortalShell({ children }) {
  return (
    <div className="cf-portal">
      <header className="cf-header">
        <div className="cf-container cf-header-inner">
          <Brand />
          <div className="cf-header-actions">
            <a className="cf-btn cf-btn-light cf-hide-sm" href={PHONE_TEL}>
              Call {PHONE_DISPLAY}
            </a>
            <a className="cf-btn cf-btn-dark" href={WHATSAPP} target="_blank" rel="noopener noreferrer">
              WhatsApp us
            </a>
          </div>
        </div>
      </header>

      <main className="cf-main">
        <div className="cf-container">{children}</div>
      </main>

      <footer className="cf-footer">
        <div className="cf-container cf-footer-grid">
          <div>
            <div className="cf-footer-title">Chequered Flag Ltd</div>
            <div className="cf-footer-muted">Established 1975</div>
            <div className="cf-footer-logo">
              <img src="/cf-flag.png" alt="Chequered Flag" width="64" height="64" />
            </div>
          </div>
          <nav className="cf-footer-links" aria-label="Chequered Flag website">
            <a href={`${SITE}/workshop`} target="_blank" rel="noopener noreferrer">Workshop</a>
            <a href={`${SITE}/vehicle-hire`} target="_blank" rel="noopener noreferrer">Vehicle Hire</a>
            <a href={SITE} target="_blank" rel="noopener noreferrer">Main website</a>
          </nav>
          <div>
            <div className="cf-eyebrow-sm">Workshop location</div>
            <div>Ngong Road, Karen, Nairobi</div>
            <a href={MAPS} target="_blank" rel="noopener noreferrer">View on Google Maps</a>
          </div>
          <div>
            <div className="cf-eyebrow-sm">Hours of operation</div>
            <div>Mon–Fri: 8:00am – 5:00pm</div>
            <div>Sat: 8:00am – 1:00pm</div>
            <div className="cf-footer-muted">Sun &amp; public holidays: Closed</div>
          </div>
          <div>
            <div className="cf-eyebrow-sm">Questions about your job?</div>
            <a href={PHONE_TEL}>{PHONE_DISPLAY}</a>
            <div>
              <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">Message us on WhatsApp</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
