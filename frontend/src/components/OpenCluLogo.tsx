/* eslint-disable @next/next/no-img-element */
import "./OpenCluLogo.css";

export function OpenCluLogo({
  className,
  markOnly = false,
  priority,
}: {
  className?: string;
  markOnly?: boolean;
  priority?: boolean;
}) {
  const lightSrc = markOnly ? "/openclu_logo_only_light.png" : "/openclu_logo_light.png";
  const darkSrc = markOnly ? "/openclu_logo_only_dark.png" : "/openclu_logo_dark.png";

  return (
    <>
      <img
        src={lightSrc}
        alt="OpenClu"
        loading={priority ? "eager" : "lazy"}
        className={`openclu-logo openclu-logo--light ${className ?? ""}`}
      />
      <img
        src={darkSrc}
        alt="OpenClu"
        loading={priority ? "eager" : "lazy"}
        className={`openclu-logo openclu-logo--dark ${className ?? ""}`}
      />
    </>
  );
}
