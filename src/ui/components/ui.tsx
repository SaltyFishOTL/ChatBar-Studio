import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { X, Image } from "lucide-react";
import { assetBlob } from "../../data/db";
import { useStudio } from "../store";
const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button-primary",
      secondary: "button-secondary",
      ghost: "button-ghost",
      destructive: "button-destructive",
    },
    size: { default: "", sm: "button-sm", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>
>(({ className, variant, size, ...props }, ref) => (
  <button
    ref={ref}
    className={clsx(buttonVariants({ variant, size }), className)}
    {...props}
  />
));
export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const studio = useStudio();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className={clsx("dialog", wide && "dialog-wide")}
          aria-describedby={undefined}
        >
          <header>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭">
                <X size={18} />
              </Button>
            </DialogPrimitive.Close>
          </header>
          <div className="dialog-body">
            {studio?.error && (
              <div className="banner banner-error" role="alert">
                {studio.error}
              </div>
            )}
            {children}
          </div>
          {footer && <footer className="dialog-fixed-footer">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(
    () => setText(Number.isFinite(value) ? String(value) : ""),
    [value],
  );
  return (
    <Field label={label}>
      <input
        type="number"
        value={text}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value !== "" && Number.isFinite(Number(e.target.value)))
            onChange(Number(e.target.value));
        }}
        onBlur={() => setText(Number.isFinite(value) ? String(value) : "")}
      />
    </Field>
  );
}
export function useImage(source: string | Blob | null | undefined) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true,
      url = "";
    setUrl("");
    if (!source) return;
    if (typeof source === "string" && source.startsWith("/data/")) {
      setUrl(source);
      return;
    }
    Promise.resolve(typeof source === "string" ? assetBlob(source) : source)
      .then((blob) => {
        if (active) {
          url = URL.createObjectURL(blob);
          setUrl(url);
        }
      })
      .catch(() => {
        if (active) setUrl("");
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);
  return url;
}
export function AssetImage({
  source,
  alt = "",
  className = "",
  onClick,
}: {
  source: string | Blob | null | undefined;
  alt?: string;
  className?: string;
  onClick?: () => void;
}) {
  const url = useImage(source);
  return url ? (
    <img
      src={url}
      alt={alt}
      className={className}
      onClick={onClick}
      loading="lazy"
    />
  ) : (
    <div className={clsx("image-placeholder", className)} onClick={onClick}>
      <Image size={28} aria-hidden="true" />
    </div>
  );
}
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);
