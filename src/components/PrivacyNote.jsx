// What HintWise's analytics (public/hw-events.js, tag in index.html) sends,
// in the words the other HintWise apps use. src/__tests__/privacy-note.test.jsx
// checks the wording; change both together.
export default function PrivacyNote({ className = '' }) {
  return (
    <p className={`text-xs text-slate-500 ${className}`} id="privacy">
      RankedVote counts visits with HintWise&apos;s own analytics: the pages viewed, how long each was on screen,
      the kind of device, the website that linked you here, links followed to other sites, and script errors.
      A contest&apos;s address is sent with its code replaced by <code>:id</code> (for example <code>/vote/:id</code>),
      and apart from what a script error message may contain, it never includes your ballot, your comments or your
      email address. Our server counts you as a visitor with a code made from your IP address, your browser&apos;s user
      agent and a random value that changes each UTC day; your IP address and user agent are not stored. The count uses
      no cookie, keeps nothing in your browser, and sends nothing if your browser has Do Not Track or Global Privacy
      Control turned on.
    </p>
  )
}
