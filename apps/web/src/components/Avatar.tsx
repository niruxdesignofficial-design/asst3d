interface Props {
  name: string;
  src?: string | null;
  /** diámetro en px (default 20, "big" clásico = 34) */
  size?: number;
  className?: string;
  title?: string;
}

/** Foto de perfil con fallback a la inicial (el clásico avatar-dot). */
export function Avatar({ name, src, size = 20, className = "", title }: Props) {
  const style = { width: size, height: size };
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        title={title}
        className={`avatar-img ${className}`}
        style={style}
        loading="lazy"
        onError={(e) => {
          // si la imagen falla, degradar al fallback ocultándola
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <span
      className={`avatar-dot ${className}`}
      style={{ ...style, fontSize: size * 0.42 }}
      title={title}
      aria-hidden
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
