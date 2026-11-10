import Link from "next/link";

export function Brand() {
  return (
    <Link className="brand" href="/">
      <span className="mark" aria-hidden="true">P</span>
      <span className="brand-name">Post<span>Guard</span></span>
    </Link>
  );
}
