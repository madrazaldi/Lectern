/**
 * The CSS in app.css already shortens animations for people who ask for reduced motion, but Svelte
 * transitions run through the Web Animations API and smooth scrolling is a JS option, so both check here.
 */

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Transition params with the duration zeroed (and no delay) when motion should be reduced. */
export function motion<P extends { duration?: number; delay?: number }>(params: P): P {
  return reducedMotion() ? { ...params, duration: 0, delay: 0 } : params;
}

export function scrollBehavior(): ScrollBehavior {
  return reducedMotion() ? 'auto' : 'smooth';
}
