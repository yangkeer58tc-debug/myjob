// Spanish (Mexico) copy for the WhatsApp recruitment bot — PRD v3.
// Keep tone friendly + professional; avoid heavy emoji; use light icons only.

export const COPY = {
  welcome:
    '¡Hola! 👋 Soy el asistente virtual de MyJob. Para postularte, primero dime tu *nombre completo*.',

  askResume: (name: string) =>
    `Gracias, ${name} 🙌\nAhora envíame tu *CV* (PDF, Word o foto). Asegúrate de que el archivo no pese más de 10 MB.`,

  fileTooLarge:
    'El archivo que enviaste pesa más de 10 MB y no lo puedo procesar. Por favor envíame una versión más liviana.',

  pleaseSendDocument:
    'Para registrar tu postulación necesito tu CV como *archivo o foto*. Adjúntalo desde WhatsApp y envíalo aquí.',

  multipleImagesHint:
    'Recibí tu CV en varias imágenes. Solo guardamos la más reciente. Si tu CV está dividido en varias fotos, te recomiendo juntarlas en un solo *PDF* y reenviarlo para que ningún detalle se pierda.',

  resumeReceived:
    '✅ Recibí tu CV. Lo voy a compartir con los reclutadores y, si tu perfil coincide con alguna vacante, *podrían* contactarte por aquí. ¡Gracias por confiar en MyJob!',

  optInOffer:
    'Una pregunta: ¿Te gustaría que incluyamos tu perfil en nuestro panel de candidatos destacados?\n\nDe esta forma, enviaremos tu CV directamente a los reclutadores cuando busquen talento con tu experiencia. Tu información es totalmente confidencial y manejamos tus datos con absoluta privacidad para tu seguridad.',

  optInLink:
    'Puedes ver cómo las empresas buscan talento aquí:\nhttps://myjob.com/buscar-candidatos\n\nSi aceptas, responde *Si*. Si prefieres no aparecer, simplemente ignora este mensaje y de todos modos compartiremos tu CV con los reclutadores.',

  optInConfirmed:
    '🎉 ¡Listo! Tu perfil ya forma parte de nuestro panel de candidatos destacados. Te avisaremos por aquí cuando una empresa muestre interés.',

  optInDeclinedOrUnclear:
    'Para incluir tu perfil en el panel de candidatos destacados, basta con que respondas *Si*. Si no te interesa, puedes ignorar este mensaje; tu CV ya quedó con nosotros y lo mostraremos a los reclutadores cuando aparezca una vacante para ti.',

  errorGeneric:
    'Tuve un problema procesando tu mensaje. Inténtalo de nuevo en unos minutos. Si el problema continúa, escríbenos por la página de MyJob.',
} as const;
