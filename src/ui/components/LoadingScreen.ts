import type { Disposable } from "@core/types";

/**
 * Loading screen with compositor-friendly animations.
 *
 * All motion uses `transform` and `opacity` so it remains smooth even while
 * the main thread is busy building the level.
 */
export class LoadingScreen implements Disposable {
  private container: HTMLDivElement;
  private barFill: HTMLDivElement;
  private statusText: HTMLDivElement;

  constructor() {
    this.container = document.createElement("div");
    this.container.className = "loading-screen";
    Object.assign(this.container.style, {
      position: "fixed",
      inset: "0",
      zIndex: "1300",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "radial-gradient(circle at 50% 28%, #121a33 0%, #090d18 58%, #03060c 100%)",
      opacity: "0",
      transition: "opacity 0.22s ease",
      pointerEvents: "all",
      overflow: "hidden",
      willChange: "opacity",
    });

    const style = document.createElement("style");
    style.id = "loading-screen-style";
    style.textContent = `
      @keyframes loadingGlowDrift {
        0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.5; }
        50% { transform: translate3d(3%, -2%, 0) scale(1.08); opacity: 0.92; }
      }
      @keyframes loadingParticleDrift {
        0% { transform: translate3d(-4%, 6%, 0) scale(0.94); opacity: 0.16; }
        35% { transform: translate3d(5%, -6%, 0) scale(1.06); opacity: 0.34; }
        70% { transform: translate3d(-6%, -13%, 0) scale(1.14); opacity: 0.2; }
        100% { transform: translate3d(8%, -20%, 0) scale(0.98); opacity: 0.3; }
      }
      @keyframes loadingFieldShift {
        0%, 100% { transform: translateX(-2%); opacity: 0.18; }
        50% { transform: translateX(2%); opacity: 0.3; }
      }
      @keyframes loadingPaneBreathe {
        0%, 100% { transform: translate3d(-50%, -50%, 0) scale(1); opacity: 0.72; }
        50% { transform: translate3d(-49.4%, -50.6%, 0) scale(1.014); opacity: 0.9; }
      }
      @keyframes loadingShimmer {
        0% { transform: translateX(-120%); }
        100% { transform: translateX(240%); }
      }
      @keyframes loadingPulse {
        0%, 100% { opacity: 0.52; }
        50% { opacity: 1; }
      }
      @keyframes loadingTitleGlow {
        0%, 100% { opacity: 1; transform: translateY(0); }
        50% { opacity: 0.88; transform: translateY(-2px); }
      }
    `;
    document.head.appendChild(style);

    const glowConfigs = [
      {
        width: "38%",
        height: "26%",
        top: "4%",
        left: "-10%",
        background:
          "radial-gradient(circle at 48% 50%, rgba(98,230,255,0.28), rgba(98,230,255,0.1) 34%, transparent 72%)",
        animation: "loadingGlowDrift 24s ease-in-out infinite alternate",
      },
      {
        width: "34%",
        height: "24%",
        top: "-4%",
        right: "-8%",
        background:
          "radial-gradient(circle at 50% 50%, rgba(255,121,186,0.24), rgba(255,121,186,0.08) 34%, transparent 72%)",
        animation: "loadingGlowDrift 28s ease-in-out infinite alternate-reverse",
      },
      {
        width: "42%",
        height: "28%",
        bottom: "-10%",
        left: "22%",
        background:
          "radial-gradient(circle at 50% 50%, rgba(123,108,255,0.2), rgba(123,108,255,0.08) 34%, transparent 74%)",
        animation: "loadingGlowDrift 30s ease-in-out infinite alternate",
      },
    ];

    for (const cfg of glowConfigs) {
      const glow = document.createElement("div");
      Object.assign(glow.style, {
        position: "absolute",
        borderRadius: "999px",
        filter: "blur(58px) saturate(130%)",
        mixBlendMode: "screen",
        opacity: "0.82",
        pointerEvents: "none",
        width: cfg.width,
        height: cfg.height,
        top: cfg.top ?? "",
        left: cfg.left ?? "",
        right: cfg.right ?? "",
        bottom: cfg.bottom ?? "",
        background: cfg.background,
        animation: cfg.animation,
        willChange: "transform, opacity",
      });
      this.container.appendChild(glow);
    }

    const pane = document.createElement("div");
    Object.assign(pane.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      width: "min(1380px, 92vw)",
      height: "min(820px, 84vh)",
      transform: "translate(-50%, -50%)",
      borderRadius: "54px",
      overflow: "hidden",
      background:
        "linear-gradient(130deg, rgba(255,255,255,0.11), rgba(255,255,255,0.025) 28%, rgba(255,255,255,0.06) 56%, rgba(255,255,255,0.025) 76%), linear-gradient(180deg, rgba(15, 23, 44, 0.52), rgba(8, 12, 24, 0.3))",
      border: "1px solid rgba(255,255,255,0.08)",
      boxShadow:
        "inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(98,230,255,0.08), 0 55px 140px rgba(0,0,0,0.34)",
      backdropFilter: "blur(40px) saturate(128%)",
      animation: "loadingPaneBreathe 16s ease-in-out infinite",
      pointerEvents: "none",
      willChange: "transform, opacity",
    });
    this.container.appendChild(pane);

    const paneSheen = document.createElement("div");
    Object.assign(paneSheen.style, {
      position: "absolute",
      inset: "0",
      borderRadius: "inherit",
      background:
        "linear-gradient(118deg, rgba(255,255,255,0.08), transparent 18%, transparent 58%, rgba(98,230,255,0.06) 70%, transparent 84%), linear-gradient(180deg, rgba(255,255,255,0.035), transparent 28%)",
      mixBlendMode: "screen",
      opacity: "0.88",
    });
    pane.appendChild(paneSheen);

    const particleConfigs = [
      { left: "12%", top: "70%", size: "240px", color: "rgba(97,229,255,0.16)", duration: "22s", delay: "-4s" },
      { left: "25%", top: "26%", size: "150px", color: "rgba(255,121,186,0.18)", duration: "18s", delay: "-9s" },
      { left: "42%", top: "76%", size: "280px", color: "rgba(123,108,255,0.16)", duration: "26s", delay: "-5s" },
      { left: "60%", top: "16%", size: "190px", color: "rgba(98,230,255,0.13)", duration: "20s", delay: "-11s" },
      { left: "82%", top: "30%", size: "320px", color: "rgba(255,121,186,0.13)", duration: "28s", delay: "-8s" },
    ];

    for (const cfg of particleConfigs) {
      const particle = document.createElement("div");
      Object.assign(particle.style, {
        position: "absolute",
        left: cfg.left,
        top: cfg.top,
        width: cfg.size,
        height: cfg.size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.16), rgba(255,255,255,0.03) 18%, transparent 62%), radial-gradient(circle at 50% 52%, ${cfg.color}, transparent 72%)`,
        filter: "blur(24px)",
        mixBlendMode: "screen",
        opacity: "0.26",
        animation: `loadingParticleDrift ${cfg.duration} ease-in-out infinite`,
        animationDelay: cfg.delay,
        willChange: "transform, opacity",
      });
      pane.appendChild(particle);
    }

    const field = document.createElement("div");
    Object.assign(field.style, {
      position: "absolute",
      inset: "-3%",
      background:
        "repeating-radial-gradient(circle at 24% 40%, rgba(98,230,255,0.08) 0 2px, transparent 2px 18px), repeating-radial-gradient(circle at 76% 24%, rgba(255,121,186,0.06) 0 2px, transparent 2px 20px), repeating-radial-gradient(circle at 58% 76%, rgba(123,108,255,0.07) 0 2px, transparent 2px 22px)",
      opacity: "0.22",
      animation: "loadingFieldShift 18s ease-in-out infinite",
      willChange: "transform, opacity",
    });
    pane.appendChild(field);

    const content = document.createElement("div");
    Object.assign(content.style, {
      position: "relative",
      zIndex: "1",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "18px",
      padding: "40px 24px",
    });
    this.container.appendChild(content);

    const badge = document.createElement("div");
    Object.assign(badge.style, {
      padding: "7px 14px",
      borderRadius: "999px",
      border: "1px solid rgba(98,230,255,0.14)",
      background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))",
      color: "rgba(224, 238, 255, 0.72)",
      fontFamily: "'Outfit', sans-serif",
      fontSize: "11px",
      fontWeight: "700",
      letterSpacing: "2px",
      textTransform: "uppercase",
      backdropFilter: "blur(12px)",
    });
    badge.textContent = "Preparing Level";
    content.appendChild(badge);

    const title = document.createElement("div");
    Object.assign(title.style, {
      fontFamily: "'Outfit', sans-serif",
      fontWeight: "800",
      fontSize: "clamp(30px, 5vw, 44px)",
      color: "#ffffff",
      letterSpacing: "5px",
      textTransform: "uppercase",
      textShadow: "0 8px 30px rgba(98,230,255,0.12), 0 0 40px rgba(123,108,255,0.14)",
      animation: "loadingTitleGlow 3s ease-in-out infinite",
      willChange: "transform, opacity",
    });
    title.textContent = "Kinema";
    content.appendChild(title);

    const subtitle = document.createElement("div");
    Object.assign(subtitle.style, {
      maxWidth: "520px",
      color: "rgba(228, 234, 255, 0.74)",
      fontFamily: "'Outfit', sans-serif",
      fontSize: "14px",
      letterSpacing: "0.4px",
      textAlign: "center",
      lineHeight: "1.6",
    });
    subtitle.textContent = "Building the next space. Lighting, physics, and props are coming online.";
    content.appendChild(subtitle);

    const track = document.createElement("div");
    Object.assign(track.style, {
      width: "clamp(220px, 28vw, 320px)",
      height: "10px",
      background: "rgba(255,255,255,0.09)",
      borderRadius: "999px",
      overflow: "hidden",
      position: "relative",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
    });

    this.barFill = document.createElement("div");
    Object.assign(this.barFill.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "100%",
      height: "100%",
      background: "linear-gradient(90deg, #62e6ff 0%, #7b6cff 52%, #ff79ba 100%)",
      borderRadius: "999px",
      boxShadow: "0 0 22px rgba(98,230,255,0.28)",
      transformOrigin: "left center",
      transform: "scaleX(0)",
      transition: "transform 0.4s ease",
      willChange: "transform",
    });
    track.appendChild(this.barFill);

    const shimmer = document.createElement("div");
    Object.assign(shimmer.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "42%",
      height: "100%",
      background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent)",
      animation: "loadingShimmer 1.6s ease-in-out infinite",
      willChange: "transform",
      pointerEvents: "none",
    });
    track.appendChild(shimmer);
    content.appendChild(track);

    this.statusText = document.createElement("div");
    Object.assign(this.statusText.style, {
      color: "rgba(228, 234, 255, 0.64)",
      fontFamily: "'Outfit', sans-serif",
      fontSize: "12px",
      letterSpacing: "1.8px",
      textTransform: "uppercase",
      animation: "loadingPulse 2s ease-in-out infinite",
      willChange: "opacity",
    });
    this.statusText.textContent = "Loading world";
    content.appendChild(this.statusText);
  }

  show(): Promise<void> {
    document.body.appendChild(this.container);
    void this.container.offsetHeight;
    this.container.style.opacity = "1";
    return new Promise((resolve) => setTimeout(resolve, 250));
  }

  hide(): Promise<void> {
    this.container.style.opacity = "0";
    return new Promise((resolve) => {
      setTimeout(() => {
        this.container.remove();
        resolve();
      }, 400);
    });
  }

  setProgress(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.barFill.style.transform = `scaleX(${clamped})`;
  }

  dispose(): void {
    this.container.remove();
    document.getElementById("loading-screen-style")?.remove();
  }
}
