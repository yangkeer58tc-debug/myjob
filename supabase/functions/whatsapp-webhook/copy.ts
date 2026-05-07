// Spanish-only copy for the MVP recruitment bot.
// Keep messages short; WhatsApp users are mobile-first.

export const COPY = {
  welcome:
    '¡Hola! 👋 Soy el asistente de MyJob. Para postularte, primero dime tu *nombre completo*.',

  askResume: (name: string) =>
    `Gracias, ${name} 🙌\n\nAhora envíame tu *CV* como archivo (PDF o Word). Solo arrástralo o tócalo desde WhatsApp y envíalo aquí.`,

  resumeReceived:
    '✅ He recibido tu CV. Lo revisaremos y nos pondremos en contacto contigo si tu perfil coincide con alguna vacante. ¡Mucha suerte!',

  pleaseSendDocument:
    'Por favor envíame tu CV como *archivo* (PDF o Word). Si solo lo tienes como foto, también puedes enviarlo como imagen.',

  alreadyCompleted:
    'Ya tenemos tu información 🙌. Te avisaremos por aquí cuando haya una vacante que coincida con tu perfil.',

  errorGeneric:
    'Ocurrió un problema procesando tu mensaje. Intenta enviarlo de nuevo en unos minutos.',
} as const;
