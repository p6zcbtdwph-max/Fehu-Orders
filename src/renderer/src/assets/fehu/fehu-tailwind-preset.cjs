// Fehu Design 0.1.0: Tailwind-Vorlage (v3), erzeugt aus tokens.json. Nicht von Hand ändern.
// Braucht fehu-tokens.css im selben Build. Einbinden: presets: [require('./…/fehu-tailwind-preset.cjs')]
// text-lg ist auf 20 px gelegt (18 px gibt es im Standard nicht), rounded-2xl/3xl auf 12 px, shadow-xl/2xl auf lg.
module.exports = {
  "theme": {
    "fontSize": {
      "xs": [
        "12px",
        {
          "lineHeight": "16px"
        }
      ],
      "small": [
        "13px",
        {
          "lineHeight": "18px"
        }
      ],
      "sm": [
        "14px",
        {
          "lineHeight": "20px"
        }
      ],
      "base": [
        "16px",
        {
          "lineHeight": "24px"
        }
      ],
      "lg": [
        "20px",
        {
          "lineHeight": "28px"
        }
      ],
      "xl": [
        "20px",
        {
          "lineHeight": "28px"
        }
      ],
      "2xl": [
        "24px",
        {
          "lineHeight": "32px"
        }
      ],
      "3xl": [
        "30px",
        {
          "lineHeight": "36px"
        }
      ],
      "4xl": [
        "36px",
        {
          "lineHeight": "40px"
        }
      ]
    },
    "borderRadius": {
      "none": "0px",
      "sm": "4px",
      "DEFAULT": "4px",
      "md": "6px",
      "lg": "8px",
      "xl": "12px",
      "2xl": "12px",
      "3xl": "12px",
      "full": "9999px"
    },
    "boxShadow": {
      "none": "none",
      "sm": "var(--fd-shadow-sm)",
      "DEFAULT": "var(--fd-shadow-sm)",
      "md": "var(--fd-shadow-md)",
      "lg": "var(--fd-shadow-lg)",
      "xl": "var(--fd-shadow-lg)",
      "2xl": "var(--fd-shadow-lg)",
      "inner": "none"
    },
    "extend": {
      "colors": {
        "accent": {
          "DEFAULT": "rgb(var(--fd-rgb-gold) / <alpha-value>)",
          "hover": "rgb(var(--fd-rgb-gold-hover) / <alpha-value>)",
          "pressed": "rgb(var(--fd-rgb-gold-pressed) / <alpha-value>)",
          "fg": "rgb(var(--fd-rgb-gold-ink) / <alpha-value>)",
          "soft": "rgb(var(--fd-rgb-gold-soft) / <alpha-value>)",
          "edge": "rgb(var(--fd-rgb-gold-edge) / <alpha-value>)",
          "on": "rgb(var(--fd-rgb-on-gold) / <alpha-value>)"
        },
        "success": {
          "DEFAULT": "rgb(var(--fd-rgb-success-solid) / <alpha-value>)",
          "fg": "rgb(var(--fd-rgb-success-fg) / <alpha-value>)",
          "soft": "rgb(var(--fd-rgb-success-soft) / <alpha-value>)",
          "edge": "rgb(var(--fd-rgb-success-edge) / <alpha-value>)"
        },
        "warning": {
          "DEFAULT": "rgb(var(--fd-rgb-warning-solid) / <alpha-value>)",
          "fg": "rgb(var(--fd-rgb-warning-fg) / <alpha-value>)",
          "soft": "rgb(var(--fd-rgb-warning-soft) / <alpha-value>)",
          "edge": "rgb(var(--fd-rgb-warning-edge) / <alpha-value>)"
        },
        "danger": {
          "DEFAULT": "rgb(var(--fd-rgb-danger-solid) / <alpha-value>)",
          "fg": "rgb(var(--fd-rgb-danger-fg) / <alpha-value>)",
          "soft": "rgb(var(--fd-rgb-danger-soft) / <alpha-value>)",
          "edge": "rgb(var(--fd-rgb-danger-edge) / <alpha-value>)"
        },
        "info": {
          "DEFAULT": "rgb(var(--fd-rgb-info-solid) / <alpha-value>)",
          "fg": "rgb(var(--fd-rgb-info-fg) / <alpha-value>)",
          "soft": "rgb(var(--fd-rgb-info-soft) / <alpha-value>)",
          "edge": "rgb(var(--fd-rgb-info-edge) / <alpha-value>)"
        },
        "on-solid": "rgb(var(--fd-rgb-on-solid) / <alpha-value>)",
        "gain": "rgb(var(--fd-rgb-gain) / <alpha-value>)",
        "loss": "rgb(var(--fd-rgb-loss) / <alpha-value>)",
        "ink": {
          "DEFAULT": "rgb(var(--fd-rgb-ink) / <alpha-value>)",
          "muted": "rgb(var(--fd-rgb-ink-muted) / <alpha-value>)",
          "faint": "rgb(var(--fd-rgb-ink-faint) / <alpha-value>)",
          "inverse": "rgb(var(--fd-rgb-ink-inverse) / <alpha-value>)"
        },
        "canvas": "rgb(var(--fd-rgb-canvas) / <alpha-value>)",
        "surface": "rgb(var(--fd-rgb-surface) / <alpha-value>)",
        "raised": "rgb(var(--fd-rgb-raised) / <alpha-value>)",
        "sunken": "rgb(var(--fd-rgb-sunken) / <alpha-value>)",
        "line": {
          "DEFAULT": "rgb(var(--fd-rgb-line) / <alpha-value>)",
          "strong": "rgb(var(--fd-rgb-line-strong) / <alpha-value>)"
        },
        "focus": "rgb(var(--fd-rgb-focus) / <alpha-value>)",
        "overlay": "var(--fd-overlay)",
        "toast": {
          "DEFAULT": "rgb(var(--fd-rgb-toast) / <alpha-value>)",
          "ink": "rgb(var(--fd-rgb-on-toast) / <alpha-value>)",
          "action": "rgb(var(--fd-rgb-toast-action) / <alpha-value>)"
        },
        "chart": {
          "1": "rgb(var(--fd-rgb-chart-1) / <alpha-value>)",
          "2": "rgb(var(--fd-rgb-chart-2) / <alpha-value>)",
          "3": "rgb(var(--fd-rgb-chart-3) / <alpha-value>)",
          "4": "rgb(var(--fd-rgb-chart-4) / <alpha-value>)",
          "5": "rgb(var(--fd-rgb-chart-5) / <alpha-value>)",
          "6": "rgb(var(--fd-rgb-chart-6) / <alpha-value>)"
        },
        "app": {
          "lifemanager": "#3FA672",
          "media": "#D9534F",
          "td": "#8A63D2",
          "familyoffice": "#3B82C4",
          "careermanager": "#1FA3A0",
          "orders": "#C9567F"
        }
      },
      "fontFamily": {
        "sans": [
          "var(--fd-font-sans)"
        ],
        "mono": [
          "var(--fd-font-mono)"
        ]
      },
      "height": {
        "control-sm": "28px",
        "control-md": "32px",
        "control-lg": "40px",
        "control-touch": "44px"
      },
      "minHeight": {
        "control-sm": "28px",
        "control-md": "32px",
        "control-lg": "40px",
        "control-touch": "44px"
      },
      "width": {
        "control-sm": "28px",
        "control-md": "32px",
        "control-lg": "40px",
        "control-touch": "44px"
      },
      "minWidth": {
        "control-sm": "28px",
        "control-md": "32px",
        "control-lg": "40px",
        "control-touch": "44px"
      },
      "transitionDuration": {
        "fast": "120ms",
        "DEFAULT": "200ms",
        "slow": "300ms"
      },
      "transitionTimingFunction": {
        "DEFAULT": "cubic-bezier(0.25, 0.46, 0.45, 0.94)"
      },
      "opacity": {
        "disabled": "0.5"
      }
    }
  }
}
