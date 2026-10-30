import type { Locale } from "./locale";

type Section = { title: string; paragraphs: string[] };
type Document = { title: string; description: string; updated: string; intro: string; sections: Section[]; contact: string };
type LegalCopy = { privacy: Document; terms: Document; contactLink: string; rightsLink: string };

export const legalContent: Record<Locale, LegalCopy> = {
  pt: {
    contactLink: "Contactar a MaioAzul",
    rightsLink: "Conhecer os seus direitos na CNPD de Cabo Verde",
    privacy: {
      title: "Política de privacidade",
      description: "Como o MaioCV trata perguntas, voz, preferências de idioma e dados técnicos.",
      updated: "Atualizada em 27 de outubro de 2026",
      intro: "O MaioCV é mantido pela MaioAzul. Esta página explica, em linguagem simples, que informação é usada quando visita o site ou utiliza o chat.",
      sections: [
        { title: "Perguntas e respostas", paragraphs: [
          "Quando envia uma pergunta no chat por texto, o texto e até 12 mensagens recentes da conversa são enviados para o serviço de chat em portal.maio.cv. Esse serviço pode consultar fontes de dados do Maio e enviar o conteúdo necessário à OpenAI para gerar a resposta.",
          "Não precisa de criar uma conta. Nesta aplicação, a conversa fica na memória da página aberta: limpar o chat, recarregar ou fechar a página remove a cópia local. Evite incluir dados pessoais sensíveis nas perguntas.",
        ] },
        { title: "Perguntas por voz", paragraphs: [
          "Se optar pelo microfone ou por um ficheiro de áudio, a gravação é enviada ao serviço de transcrição através do Vercel AI Gateway e da OpenAI. O texto transcrito é então usado como pergunta. A entrada por voz é opcional.",
        ] },
        { title: "Conversa por voz em direto", paragraphs: [
          "Se iniciar a conversa por voz do Ask Maio, a ElevenLabs processa o áudio e as transcrições para ouvir as suas perguntas e responder por voz. A conversa usa o modelo de linguagem configurado, atualmente Nemotron através da ElevenLabs, que recebe o conteúdo necessário para gerar respostas e pode consultar dados públicos através de portal.maio.cv. Esta funcionalidade é opcional.",
          "A configuração do agente ElevenLabs desativa a gravação de áudio e define a retenção das transcrições como um dia. Estas definições não significam ausência de processamento ou de registos técnicos pelos prestadores, que seguem as suas próprias políticas.",
          "O painel de voz não apresenta uma transcrição da chamada. Fechar o painel não elimina por si só os dados que os prestadores conservem.",
        ] },
        { title: "Preferências e utilização", paragraphs: [
          "Usamos um cookie de idioma, com duração máxima de um ano, para apresentar o site no idioma escolhido. A rotação das sugestões de perguntas usa o armazenamento da sessão do navegador. O serviço offline guarda apenas ficheiros da interface, não conversas ou respostas da API.",
          "O serviço de chat regista contagens de pedidos e, quando a base de dados está disponível, um identificador derivado por hash do endereço de rede ou de dados técnicos do navegador, com datas da primeira e última utilização. Essas contagens não incluem o texto das perguntas.",
        ] },
        { title: "Serviços e conservação", paragraphs: [
          "A aplicação é alojada na Vercel; o chat por texto é processado pelo portal.maio.cv e pela OpenAI. A conversa por voz usa a ElevenLabs e o modelo Nemotron disponibilizado através desse serviço. Os prestadores podem tratar dados noutros países e manter registos técnicos segundo as suas próprias políticas.",
          "A conversa local dura apenas enquanto a página permanece aberta. O cookie de idioma dura até um ano. As contagens de utilização do serviço de chat não têm atualmente um prazo de eliminação automática configurado.",
        ] },
        { title: "As suas escolhas e direitos", paragraphs: [
          "Pode limpar a conversa no chat e mudar de idioma a qualquer momento. Para pedir informação, acesso, correção ou eliminação de dados pessoais que possamos identificar, contacte a MaioAzul. Pode também consultar a Comissão Nacional de Proteção de Dados de Cabo Verde.",
        ] },
        { title: "Outros sites e alterações", paragraphs: [
          "Os links para VisitMaio, fontes de dados e outros serviços levam a sites com políticas próprias. Podemos atualizar esta página quando o funcionamento do MaioCV mudar; a data acima indica a versão publicada.",
        ] },
      ],
      contact: "Para questões de privacidade ou pedidos relativos aos seus dados:",
    },
    terms: {
      title: "Termos de utilização",
      description: "Condições simples para utilizar o site, o chat e as fontes do MaioCV.",
      updated: "Atualizados em 23 de outubro de 2026",
      intro: "O MaioCV ajuda a descobrir o Maio através de conteúdos públicos, dados e respostas geradas por inteligência artificial. Ao usar o site, pedimos que respeite as regras abaixo.",
      sections: [
        { title: "O que o serviço oferece", paragraphs: [
          "Pode explorar páginas, consultar fontes e fazer perguntas sobre o Maio. O conteúdo é informativo e pode mudar ou ficar temporariamente indisponível.",
        ] },
        { title: "Confirme as respostas", paragraphs: [
          "As respostas do chat são geradas por IA e podem conter erros, omissões ou dados desatualizados. Confirme números, datas, locais e links nas fontes indicadas antes de tomar decisões. O chat não substitui aconselhamento profissional, médico, jurídico ou financeiro.",
        ] },
        { title: "Uso responsável", paragraphs: [
          "Não utilize o site para fins ilegais, ataques, sobrecarga do serviço ou tentativas de obter acesso não autorizado. Não envie dados pessoais de outras pessoas sem fundamento para o fazer.",
        ] },
        { title: "Fontes e direitos", paragraphs: [
          "Dados, imagens e conteúdos ligados a terceiros pertencem aos respetivos titulares e podem ter condições próprias. Mantenha a atribuição das fontes ao reutilizar informação. Os links externos são fornecidos para facilitar a consulta; não controlamos esses sites.",
        ] },
        { title: "Alterações e contacto", paragraphs: [
          "A MaioAzul pode alterar ou suspender funcionalidades e atualizar estes termos. A data acima mostra a versão publicada. Nada nesta página limita direitos que a lei aplicável não permita limitar.",
        ] },
      ],
      contact: "Se tiver dúvidas sobre estes termos:",
    },
  },
  en: {
    contactLink: "Contact MaioAzul",
    rightsLink: "Read about your rights at Cabo Verde's CNPD",
    privacy: {
      title: "Privacy policy",
      description: "How MaioCV handles questions, voice, language preferences, and technical data.",
      updated: "Updated 27 October 2026",
      intro: "MaioCV is maintained by MaioAzul. This page explains, in plain language, what information is used when you visit the site or use the chat.",
      sections: [
        { title: "Questions and answers", paragraphs: [
          "When you send a question in text chat, its text and up to 12 recent conversation messages go to the chat service at portal.maio.cv. That service may consult Maio data sources and send the content needed to OpenAI to generate an answer.",
          "You do not need an account. In this app, the conversation stays in the open page's memory: clearing the chat, reloading, or closing the page removes the local copy. Please avoid entering sensitive personal information.",
        ] },
        { title: "Voice questions", paragraphs: [
          "If you choose the microphone or an audio file, the recording is sent for transcription through Vercel AI Gateway and OpenAI. The transcript is then used as your question. Voice input is optional.",
        ] },
        { title: "Live voice conversation", paragraphs: [
          "If you start an Ask Maio voice conversation, ElevenLabs processes audio and transcripts to hear your questions and speak its answers. The conversation uses the configured language model, currently Nemotron through ElevenLabs, which receives the content needed to generate responses and can query public data through portal.maio.cv. This feature is optional.",
          "The ElevenLabs agent configuration disables audio recording and sets transcript retention to one day. These settings do not mean that providers perform no processing or keep no technical logs; their own policies also apply.",
          "The voice panel does not display a call transcript. Closing it does not itself delete data retained by providers.",
        ] },
        { title: "Preferences and usage", paragraphs: [
          "A language cookie, lasting up to one year, keeps the site in your chosen language. Rotating question suggestions use browser session storage. The offline service caches interface files only, not conversations or API answers.",
          "The chat service records request counts and, when its database is available, a hashed identifier derived from a network address or browser details, plus first and last use dates. Those counters do not contain question text.",
        ] },
        { title: "Service providers and retention", paragraphs: [
          "Vercel hosts the app; portal.maio.cv and OpenAI process text chat requests. Live voice conversation uses ElevenLabs and the Nemotron model provided through that service. Providers may process data in other countries and keep technical logs under their own policies.",
          "The local conversation lasts only while the page is open. The language cookie lasts up to one year. The chat service's usage counters currently have no automatic deletion period configured.",
        ] },
        { title: "Your choices and rights", paragraphs: [
          "You can clear the chat and change language at any time. To request information, access, correction, or deletion of personal data we can identify, contact MaioAzul. You can also consult Cabo Verde's National Data Protection Commission.",
        ] },
        { title: "Other sites and changes", paragraphs: [
          "Links to VisitMaio, data sources, and other services lead to sites with their own policies. We may update this page as MaioCV changes; the date above identifies the published version.",
        ] },
      ],
      contact: "For privacy questions or requests about your data:",
    },
    terms: {
      title: "Terms of use",
      description: "Simple conditions for using MaioCV, its chat, and its data sources.",
      updated: "Updated 23 October 2026",
      intro: "MaioCV helps you discover Maio through public content, data, and AI-generated answers. Please follow these terms when using the site.",
      sections: [
        { title: "What the service offers", paragraphs: [
          "You can explore pages, consult sources, and ask questions about Maio. The content is informational and may change or be temporarily unavailable.",
        ] },
        { title: "Check the answers", paragraphs: [
          "AI chat answers may contain errors, omissions, or outdated information. Check figures, dates, places, and links against the cited sources before acting on them. The chat does not replace professional medical, legal, or financial advice.",
        ] },
        { title: "Responsible use", paragraphs: [
          "Do not use the site for unlawful purposes, attacks, excessive traffic, or attempts to gain unauthorized access. Do not submit another person's private information without a proper reason to do so.",
        ] },
        { title: "Sources and rights", paragraphs: [
          "Third-party data, images, and linked content belong to their respective owners and may have separate terms. Keep source attribution when reusing information. External links are provided for convenience; we do not control those sites.",
        ] },
        { title: "Changes and contact", paragraphs: [
          "MaioAzul may change or suspend features and update these terms. The date above identifies the published version. Nothing here limits rights that cannot lawfully be limited.",
        ] },
      ],
      contact: "If you have a question about these terms:",
    },
  },
  fr: {
    contactLink: "Contacter MaioAzul",
    rightsLink: "Consulter vos droits auprès de la CNPD du Cabo Verde",
    privacy: {
      title: "Politique de confidentialité",
      description: "Comment MaioCV traite les questions, la voix, les préférences de langue et les données techniques.",
      updated: "Mise à jour le 27 octobre 2026",
      intro: "MaioCV est géré par MaioAzul. Cette page explique simplement quelles informations sont utilisées lorsque vous visitez le site ou utilisez le chat.",
      sections: [
        { title: "Questions et réponses", paragraphs: [
          "Lorsque vous envoyez une question dans le chat écrit, son texte et jusqu'à 12 messages récents de la conversation sont transmis au service de chat de portal.maio.cv. Ce service peut consulter des sources de données sur Maio et transmettre à OpenAI le contenu nécessaire pour produire une réponse.",
          "Aucun compte n'est nécessaire. Dans cette application, la conversation reste dans la mémoire de la page ouverte : effacer le chat, recharger ou fermer la page supprime la copie locale. Évitez de saisir des données personnelles sensibles.",
        ] },
        { title: "Questions vocales", paragraphs: [
          "Si vous choisissez le microphone ou un fichier audio, l'enregistrement est envoyé pour transcription via Vercel AI Gateway et OpenAI. Le texte transcrit sert ensuite de question. La saisie vocale est facultative.",
        ] },
        { title: "Conversation vocale en direct", paragraphs: [
          "Si vous lancez une conversation vocale avec Ask Maio, ElevenLabs traite l'audio et les transcriptions pour entendre vos questions et répondre à voix haute. La conversation utilise le modèle de langage configuré, actuellement Nemotron via ElevenLabs, qui reçoit le contenu nécessaire pour produire des réponses et peut consulter des données publiques via portal.maio.cv. Cette fonctionnalité est facultative.",
          "La configuration de l'agent ElevenLabs désactive l'enregistrement audio et fixe la conservation des transcriptions à un jour. Ces réglages ne signifient pas que les prestataires ne traitent aucune donnée ou ne conservent aucun journal technique ; leurs propres politiques s'appliquent également.",
          "Le panneau vocal n’affiche pas de transcription de l’appel. Le fermer ne supprime pas en soi les données conservées par les prestataires.",
        ] },
        { title: "Préférences et utilisation", paragraphs: [
          "Un cookie de langue, conservé jusqu'à un an, garde le site dans la langue choisie. La rotation des suggestions utilise le stockage de session du navigateur. Le service hors ligne ne met en cache que des fichiers d'interface, jamais les conversations ou les réponses de l'API.",
          "Le service de chat enregistre le nombre de requêtes et, si sa base de données est disponible, un identifiant haché dérivé de l'adresse réseau ou de données techniques du navigateur, ainsi que les dates de première et de dernière utilisation. Ces compteurs ne contiennent pas le texte des questions.",
        ] },
        { title: "Prestataires et conservation", paragraphs: [
          "Vercel héberge l'application ; portal.maio.cv et OpenAI traitent les demandes du chat écrit. La conversation vocale en direct utilise ElevenLabs et le modèle Nemotron proposé via ce service. Les prestataires peuvent traiter des données dans d'autres pays et conserver des journaux techniques selon leurs propres politiques.",
          "La conversation locale ne dure que tant que la page reste ouverte. Le cookie de langue dure jusqu'à un an. Aucun délai de suppression automatique n'est actuellement configuré pour les compteurs d'utilisation du service de chat.",
        ] },
        { title: "Vos choix et vos droits", paragraphs: [
          "Vous pouvez effacer le chat et changer de langue à tout moment. Pour demander des informations, l'accès, la rectification ou la suppression de données personnelles que nous pouvons identifier, contactez MaioAzul. Vous pouvez aussi consulter la Commission nationale de protection des données du Cabo Verde.",
        ] },
        { title: "Autres sites et modifications", paragraphs: [
          "Les liens vers VisitMaio, les sources de données et d'autres services mènent à des sites ayant leurs propres politiques. Nous pouvons mettre cette page à jour lorsque MaioCV évolue ; la date ci-dessus indique la version publiée.",
        ] },
      ],
      contact: "Pour toute question de confidentialité ou demande relative à vos données :",
    },
    terms: {
      title: "Conditions d’utilisation",
      description: "Conditions simples pour utiliser MaioCV, son chat et ses sources de données.",
      updated: "Mises à jour le 23 octobre 2026",
      intro: "MaioCV vous aide à découvrir Maio grâce à des contenus publics, des données et des réponses générées par l'IA. Merci de respecter ces conditions lorsque vous utilisez le site.",
      sections: [
        { title: "Ce que propose le service", paragraphs: [
          "Vous pouvez explorer les pages, consulter les sources et poser des questions sur Maio. Le contenu est informatif et peut changer ou être temporairement indisponible.",
        ] },
        { title: "Vérifiez les réponses", paragraphs: [
          "Les réponses du chat générées par l'IA peuvent contenir des erreurs, des omissions ou des informations dépassées. Vérifiez les chiffres, dates, lieux et liens auprès des sources citées avant d'agir. Le chat ne remplace pas un conseil professionnel médical, juridique ou financier.",
        ] },
        { title: "Utilisation responsable", paragraphs: [
          "N'utilisez pas le site à des fins illégales, pour attaquer ou surcharger le service, ou pour tenter d'obtenir un accès non autorisé. Ne transmettez pas les informations privées d'une autre personne sans raison valable.",
        ] },
        { title: "Sources et droits", paragraphs: [
          "Les données, images et contenus de tiers appartiennent à leurs titulaires et peuvent être soumis à des conditions distinctes. Conservez l'attribution des sources lorsque vous réutilisez des informations. Les liens externes sont fournis pour faciliter la consultation ; nous ne contrôlons pas ces sites.",
        ] },
        { title: "Modifications et contact", paragraphs: [
          "MaioAzul peut modifier ou suspendre des fonctionnalités et mettre à jour ces conditions. La date ci-dessus indique la version publiée. Rien ici ne limite les droits qui ne peuvent légalement être limités.",
        ] },
      ],
      contact: "Pour toute question sur ces conditions :",
    },
  },
};
