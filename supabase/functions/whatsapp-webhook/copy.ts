// Spanish (Mexico) copy for the WhatsApp recruitment bot — v4 (no name step,
// job ref, returning user, interactive opt-in, post-flow actions).

const site = () => (Deno.env.get('MYJOB_PUBLIC_SITE_URL') ?? 'https://myjob.com').replace(/\/+$/, '');

export const COPY = {
  welcomeNoJob:
    '¡Hola! 👋 Soy el asistente de *MyJob*. Para postularte, envíame tu *CV* (PDF, Word o foto, máx. 10 MB).\n\n' +
    '_Guarda este contacto como **MyJob** para no perder mensajes._',

  welcomeWithJob: (jobTitle: string, company: string) =>
    `¡Hola! 👋 Soy el asistente de *MyJob*.\nPara postular a *${jobTitle}* en *${company}*, envíame tu *CV* (PDF, Word o foto, máx. 10 MB).\n\n` +
    '_Guarda este contacto como **MyJob** para no perder mensajes._',

  returningAskChoice: (jobTitle: string, company: string) =>
    `Ya tenemos un CV tuyo en *MyJob*. ¿Quieres postular a *${jobTitle}* en *${company}* con el *mismo archivo* o prefieres *subir uno nuevo*?`,

  returningAskChoiceNoJob:
    'Ya tenemos un CV tuyo en *MyJob*. ¿Quieres usar el *mismo archivo* o *subir uno nuevo*?',

  fileTooLarge:
    'El archivo que enviaste pesa más de 10 MB y no lo puedo procesar. Por favor envíame una versión más liviana.',

  pleaseSendDocument:
    'Para registrar tu postulación necesito tu CV como *archivo o foto*. Adjúntalo desde WhatsApp y envíalo aquí.',

  multipleImagesHint:
    'Recibí tu CV en varias imágenes. Solo guardamos la más reciente. Si tu CV está dividido en varias fotos, te recomiendo juntarlas en un solo *PDF* y reenviarlo para que ningún detalle se pierda.',

  resumeReceivedLine: '✅ Recibí tu CV.',

  /** Body for interactive opt-in (single screen, ≤1024 chars). */
  optInInteractiveBody: () => {
    const base = site();
    return (
      `✅ Recibí tu CV.\n\n` +
      `¿Te sumamos al *panel de candidatos destacados* de MyJob?\n\n` +
      `Los reclutadores podrán contactarte cuando busquen tu perfil. Tu información es *100% confidencial*.\n\n` +
      `Mira cómo te verán: ${base}/buscar-candidatos`
    );
  },

  optInConfirmed:
    '🎉 ¡Listo! Tu perfil ya forma parte del panel de *MyJob*. Te avisaremos por aquí cuando una empresa muestre interés.',

  /** After opt-in declined: still have CV; offer panel later. */
  optInDeclinedNote:
    'Entendido: no te sumamos al panel por ahora. Tu CV ya quedó con nosotros y lo compartiremos con reclutadores cuando haya vacantes afines.',

  optInDeclinedOrUnclear:
    'Para sumarte al panel, toca *Sí, súmame* o escribe *Si*. Si no te interesa, toca *Ahora no*.',

  noCvClose:
    'Sin problema. Cuando tengas tu CV listo, vuelve a escribirnos por aquí o entra en ' +
    site() +
    '/empleos para ver vacantes.',

  returningSameSynced: (jobTitle: string) =>
    `Listo: usamos tu CV anterior y quedó registrada tu postulación a *${jobTitle}*. ` +
    `También lo actualizamos en el panel de candidatos.`,

  errorGeneric:
    'Tuve un problema procesando tu mensaje. Inténtalo de nuevo en unos minutos. Si el problema continúa, escríbenos desde la página de MyJob.',

  postFlowIntro: '¿Qué te gustaría hacer ahora?',

  postFlowMoreJobs: () => `Aquí tienes vacantes abiertas: ${site()}/empleos`,

  postFlowRecommend: (q: string) => {
    const base = site();
    const enc = encodeURIComponent(q.trim() || 'empleo');
    return `Vacantes relacionadas con tu perfil: ${base}/buscar-candidatos?q=${enc}`;
  },

  postFlowHelp: () =>
    `Puedes explorar más en ${site()} o escribirnos por el formulario de contacto en la web.`,

  postFlowJoinPanelReminder:
    'Si cambias de opinión y quieres aparecer en el panel de candidatos, toca *Súmame al panel* o escribe *Si*.',

  menuHint: '_Escribe **menu** en cualquier momento para ver opciones._',
} as const;
