// Page footer: source link on the left, credit in the middle. The wording is
// fixed (not translated) by request.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <a className="footer-source" href="https://github.com/ryogrid/nporkerd" target="_blank" rel="noopener noreferrer">
        source code
      </a>
      <span className="footer-credit">
        nporkerd powered by{" "}
        <a href="https://convex.dev/" target="_blank" rel="noopener noreferrer">Convex</a>
      </span>
      <span aria-hidden="true" />
    </footer>
  );
}
