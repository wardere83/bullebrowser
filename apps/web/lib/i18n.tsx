'use client';

// Client-side translation for a statically exported site.
//
// The locale lives in localStorage (written by TranslationMenu) rather than in
// the URL, because `output: 'export'` gives us no server to negotiate a locale
// per request. A provider re-renders the tree when it changes.
//
// Brand and product names are deliberately absent from these dictionaries:
// "BulleBrowser", "Bulle Consulting" and the skill names are what the product
// is called in every language, so translating them would make the site harder
// to talk about, not easier to read.

import { createContext, useContext, useEffect, useState } from 'react';

export const LOCALES = ['en', 'fr', 'ar', 'es-419', 'pt-PT'] as const;
export type Locale = (typeof LOCALES)[number];
export const STORAGE_KEY = 'bullebrowser:lang';

type Dict = Record<string, string>;

const en: Dict = {
  // nav
  'nav.home': 'Home',
  'nav.workflows': 'Workflows',
  'nav.guides': 'Guides',
  'nav.download': 'Download',
  'nav.translation': 'Translation',
  'nav.chooseLanguage': 'Choose a language',
  // footer
  'footer.rights': 'All rights reserved.',
  'footer.tagline': 'The browser that navigates for you',
  // home hero
  'home.badge': 'Agentic AI · By',
  'home.h1': 'The browser that navigates for you.',
  'home.sub':
    'An AI agent that reads pages, completes browser tasks, and works whatever else you ask, right inside your browser.',
  // home skills
  'film.title': 'See it work.',
  'film.play': 'Play the BulleBrowser film',
  'film.pause': 'Pause the film',
  'film.fallback': 'The film could not load. Try refreshing the page.',
  'film.demo': 'Try the assistant',
  'film.description': 'A person asks BulleBrowser to find grants for a community empowerment project in New Jersey and Los Angeles. The assistant opens Grants.gov, searches, reads the results, opens the top three opportunities in new tabs, and returns a cited comparison, while the person stays in control and their data stays on their device.',
  'home.skills.eyebrow': 'Agentic skills',
  'home.skills.h2': 'Native intelligence, built into the browser.',
  'home.skills.body':
    'Not a chatbot bolted onto a sidebar. It is purpose-built for general browser automation. Three flagship skills lead the way, and the agent takes on much more on request.',
  'home.skills.explore': 'Explore the features',
  'skill.page.title': 'Page assistant',
  'skill.page.lede': 'Read and summarize what is on screen.',
  'skill.page.body':
    'Ask it to read a page, lift the important points, and give you a concise answer with citations.',
  'skill.nav.title': 'Site navigator',
  'skill.nav.lede': 'Handle a task inside a live website.',
  'skill.nav.body':
    'Tell it where to go and what to do. It opens the page, finds the control, and completes the action.',
  'skill.flow.title': 'Workflow automator',
  'skill.flow.lede': 'Coordinate multi-step browser tasks.',
  'skill.flow.body':
    'Use it for repeatable sequences across tabs: compare pages, gather details, and return a clean summary.',
  // home privacy
  'home.privacy.h2': 'Your data stays yours.',
  'home.privacy.body':
    'Bring your own key if you want external synthesis. Prompts go directly through your configured AI provider account from your device. History and conversations stay on your device. No telemetry.',
  'features.h1': 'An agent that operates the browser, so you don’t have to.',
  'features.sub': 'It pairs a real, full-featured browser with a BulleBrowser-powered agent. It works the web the way a person does, reading, clicking, typing, and extracting, all in a deterministic, stoppable loop you can trust.',
  'features.cap.eyebrow': 'Capabilities',
  'features.cap.title': 'It works the live web, not a stale index.',
  'features.cap.body': 'The agent acts on the active tab, with the same pages, same logins, and same data you would see, through a focused set of actions:',
  'features.tool.navigate.t': 'Navigate',
  'features.tool.navigate.d': 'Open any URL in a live tab.',
  'features.tool.read.t': 'Read',
  'features.tool.read.d': 'Pull clean, readable text from the page.',
  'features.tool.click.t': 'Click & type',
  'features.tool.click.d': 'Operate forms and controls by label or selector.',
  'features.tool.extract.t': 'Extract',
  'features.tool.extract.d': 'Lift structured data to a schema you define.',
  'features.tool.tabs.t': 'Manage tabs',
  'features.tool.tabs.d': 'Open, switch, and coordinate across tabs.',
  'features.tool.wait.t': 'Wait',
  'features.tool.wait.d': 'Pause for an element or the network to settle.',
  'features.skills.eyebrow': 'Skills',
  'features.skills.title': 'Three flagship skills, and a general agent for the rest.',
  'features.skills.foot': 'These three lead the way, among many other tasks the agent will take on. Pick a preset for a guided workflow, or just describe what you need in plain language and it works the live tab.',
  'features.ctrl.eyebrow': 'Control & trust',
  'features.ctrl.title': 'Powerful, but never on autopilot.',
  'features.ctrl.control.t': 'You stay in control',
  'features.ctrl.control.d': 'A live indicator shows each step, and a Stop button cancels instantly.',
  'features.ctrl.runaway.t': 'No runaways',
  'features.ctrl.runaway.d': 'Every task runs on a step budget: it warns at 75% and stops at the limit, and you can raise it per task.',
  'features.ctrl.ask.t': 'Ask before acting',
  'features.ctrl.ask.d': 'Form submissions and downloads require your explicit confirmation.',
  'features.ctrl.model.t': 'Your model',
  'features.ctrl.model.d': 'Choose Pro, Balanced, or Fastest per task.',
  'features.priv.eyebrow': 'Privacy',
  'features.priv.title': 'Bring your own key. Keep your own data.',
  'features.priv.1': 'Your prompts go directly through your configured provider from your device.',
  'features.priv.2': 'Your API key is encrypted in your operating system’s keychain.',
  'features.priv.3': 'History, bookmarks, and conversations stay on your device.',
  'features.priv.4': 'No analytics. No telemetry.',
  'features.cta.h2': 'Put the agent to work.',
  'features.cta.sub': 'Available for macOS, Windows, and Linux.',
  'download.badge': 'Official downloads',
  'download.h1': 'Download',
  'download.sub': 'Every installer here is tied to the current release channel and includes the in-browser agentic browser experience.',
  'download.signed': 'Releases are signed and notarized on macOS and Windows.',
};

const fr: Dict = {
  'nav.home': 'Accueil',
  'nav.workflows': 'Flux de travail',
  'nav.guides': 'Guides',
  'nav.download': 'Télécharger',
  'nav.translation': 'Traduction',
  'nav.chooseLanguage': 'Choisir une langue',
  'footer.rights': 'Tous droits réservés.',
  'footer.tagline': 'Le navigateur qui navigue pour vous',
  'home.badge': 'IA agentique · Par',
  'home.h1': 'Le navigateur qui navigue pour vous.',
  'home.sub':
    "Un agent IA qui lit les pages, accomplit les tâches du navigateur et fait tout ce que vous lui demandez, directement dans votre navigateur.",
  'film.title': 'Voyez-le à l’œuvre.',
  'film.play': 'Lire le film BulleBrowser',
  'film.pause': 'Mettre le film en pause',
  'film.fallback': 'Le film n’a pas pu être chargé. Actualisez la page.',
  'film.demo': 'Essayez l’assistant',
  'film.description': 'Une personne demande à BulleBrowser de trouver des subventions pour un projet d’autonomisation communautaire dans le New Jersey et à Los Angeles. L’assistant ouvre Grants.gov, lance la recherche, lit les résultats, ouvre les trois meilleures opportunités dans de nouveaux onglets et rend une comparaison sourcée, tandis que la personne garde le contrôle et que ses données restent sur son appareil.',
  'home.skills.eyebrow': 'Compétences agentiques',
  'home.skills.h2': "Une intelligence native, intégrée au navigateur.",
  'home.skills.body':
    "Pas un agent conversationnel greffé sur un panneau latéral. Il est conçu pour l'automatisation générale du navigateur. Trois compétences phares ouvrent la voie, et l'agent en assume bien davantage sur demande.",
  'home.skills.explore': 'Découvrir les fonctionnalités',
  'skill.page.title': 'Assistant de page',
  'skill.page.lede': "Lire et résumer ce qui est à l'écran.",
  'skill.page.body':
    'Demandez-lui de lire une page, d’en extraire les points essentiels et de vous donner une réponse concise avec ses sources.',
  'skill.nav.title': 'Navigateur de site',
  'skill.nav.lede': 'Accomplir une tâche sur un site en direct.',
  'skill.nav.body':
    "Indiquez-lui où aller et quoi faire. Il ouvre la page, trouve le contrôle et accomplit l'action.",
  'skill.flow.title': 'Automatisation de flux',
  'skill.flow.lede': 'Coordonner des tâches en plusieurs étapes.',
  'skill.flow.body':
    'Utilisez-le pour des séquences répétables entre onglets : comparer des pages, réunir des informations et renvoyer un résumé clair.',
  'home.privacy.h2': 'Vos données restent les vôtres.',
  'home.privacy.body':
    "Utilisez votre propre clé si vous souhaitez une synthèse externe. Les requêtes passent directement par le compte de votre fournisseur d'IA, depuis votre appareil. L'historique et les conversations restent sur votre appareil. Aucune télémétrie.",
  'features.h1': 'Un agent qui pilote le navigateur, pour que vous n’ayez plus à le faire.',
  'features.sub': 'Il associe un vrai navigateur complet à un agent propulsé par BulleBrowser. Il parcourt le web comme le ferait une personne : lire, cliquer, saisir et extraire, le tout dans une boucle déterministe et interruptible en laquelle vous pouvez avoir confiance.',
  'features.cap.eyebrow': 'Capacités',
  'features.cap.title': 'Il agit sur le web réel, pas sur un index périmé.',
  'features.cap.body': 'L’agent agit sur l’onglet actif, avec les mêmes pages, les mêmes connexions et les mêmes données que vous verriez, à travers un ensemble d’actions ciblées :',
  'features.tool.navigate.t': 'Naviguer',
  'features.tool.navigate.d': 'Ouvrir n’importe quelle URL dans un onglet actif.',
  'features.tool.read.t': 'Lire',
  'features.tool.read.d': 'Extraire un texte propre et lisible de la page.',
  'features.tool.click.t': 'Cliquer et saisir',
  'features.tool.click.d': 'Utiliser les formulaires et contrôles par libellé ou sélecteur.',
  'features.tool.extract.t': 'Extraire',
  'features.tool.extract.d': 'Récupérer des données structurées selon un schéma que vous définissez.',
  'features.tool.tabs.t': 'Gérer les onglets',
  'features.tool.tabs.d': 'Ouvrir, changer et coordonner plusieurs onglets.',
  'features.tool.wait.t': 'Attendre',
  'features.tool.wait.d': 'Attendre qu’un élément ou le réseau se stabilise.',
  'features.skills.eyebrow': 'Compétences',
  'features.skills.title': 'Trois compétences phares, et un agent généraliste pour le reste.',
  'features.skills.foot': 'Ces trois compétences ouvrent la voie, parmi bien d’autres tâches que l’agent accomplit. Choisissez un préréglage pour un flux guidé, ou décrivez simplement votre besoin en langage clair.',
  'features.ctrl.eyebrow': 'Contrôle et confiance',
  'features.ctrl.title': 'Puissant, mais jamais en pilote automatique.',
  'features.ctrl.control.t': 'Vous gardez le contrôle',
  'features.ctrl.control.d': 'Un indicateur en direct montre chaque étape, et un bouton Arrêter annule instantanément.',
  'features.ctrl.runaway.t': 'Aucun emballement',
  'features.ctrl.runaway.d': 'Chaque tâche dispose d’un budget d’étapes : alerte à 75 %, arrêt à la limite, et vous pouvez l’augmenter pour chaque tâche.',
  'features.ctrl.ask.t': 'Demander avant d’agir',
  'features.ctrl.ask.d': 'Les envois de formulaires et les téléchargements exigent votre confirmation explicite.',
  'features.ctrl.model.t': 'Votre modèle',
  'features.ctrl.model.d': 'Choisissez Pro, Équilibré ou Le plus rapide selon la tâche.',
  'features.priv.eyebrow': 'Confidentialité',
  'features.priv.title': 'Utilisez votre propre clé. Gardez vos propres données.',
  'features.priv.1': 'Vos requêtes passent directement par votre fournisseur configuré, depuis votre appareil.',
  'features.priv.2': 'Votre clé API est chiffrée dans le trousseau de votre système d’exploitation.',
  'features.priv.3': 'Historique, favoris et conversations restent sur votre appareil.',
  'features.priv.4': 'Aucune analyse. Aucune télémétrie.',
  'features.cta.h2': 'Mettez l’agent au travail.',
  'features.cta.sub': 'Disponible pour macOS, Windows et Linux.',
  'download.badge': 'Téléchargements officiels',
  'download.h1': 'Télécharger',
  'download.sub': 'Chaque programme d’installation ici est lié au canal de version actuel et inclut l’expérience de navigateur agentique intégrée.',
  'download.signed': 'Les versions sont signées et notariées sur macOS et Windows.',
};

const ar: Dict = {
  'nav.home': 'الرئيسية',
  'nav.workflows': 'سير العمل',
  'nav.guides': 'الأدلة',
  'nav.download': 'تنزيل',
  'nav.translation': 'الترجمة',
  'nav.chooseLanguage': 'اختر لغة',
  'footer.rights': 'جميع الحقوق محفوظة.',
  'footer.tagline': 'المتصفح الذي يتصفح نيابة عنك',
  'home.badge': 'ذكاء اصطناعي وكيل · من',
  'home.h1': 'المتصفح الذي يتصفح نيابة عنك.',
  'home.sub':
    'وكيل ذكاء اصطناعي يقرأ الصفحات، وينجز مهام المتصفح، وينفذ كل ما تطلبه، داخل متصفحك مباشرة.',
  'film.title': 'شاهده وهو يعمل.',
  'film.play': 'تشغيل فيلم BulleBrowser',
  'film.pause': 'إيقاف الفيلم مؤقتًا',
  'film.fallback': 'تعذّر تحميل الفيلم. حاول تحديث الصفحة.',
  'film.demo': 'جرّب المساعد',
  'film.description': 'يطلب شخص من BulleBrowser العثور على منح لمشروع تمكين مجتمعي في نيوجيرسي ولوس أنجلوس. يفتح المساعد موقع Grants.gov، ويبحث، ويقرأ النتائج، ويفتح أفضل ثلاث فرص في علامات تبويب جديدة، ثم يقدّم مقارنة موثّقة بالمصادر، بينما يبقى الشخص متحكمًا وتبقى بياناته على جهازه.',
  'home.skills.eyebrow': 'المهارات الوكيلة',
  'home.skills.h2': 'ذكاء أصيل مدمج داخل المتصفح.',
  'home.skills.body':
    'ليس روبوت محادثة مُلحقًا بشريط جانبي. إنه مصمم خصيصًا لأتمتة المتصفح بشكل عام. ثلاث مهارات رئيسية تتصدر العمل، والوكيل ينفذ ما هو أكثر عند الطلب.',
  'home.skills.explore': 'استكشف الميزات',
  'skill.page.title': 'مساعد الصفحة',
  'skill.page.lede': 'قراءة وتلخيص ما يظهر على الشاشة.',
  'skill.page.body':
    'اطلب منه قراءة صفحة، واستخلاص النقاط المهمة، وتقديم إجابة موجزة مع ذكر المصادر.',
  'skill.nav.title': 'متصفح المواقع',
  'skill.nav.lede': 'إنجاز مهمة داخل موقع نشط.',
  'skill.nav.body':
    'أخبره إلى أين يذهب وماذا يفعل. يفتح الصفحة، ويجد عنصر التحكم، وينفذ الإجراء.',
  'skill.flow.title': 'أتمتة سير العمل',
  'skill.flow.lede': 'تنسيق مهام متعددة الخطوات.',
  'skill.flow.body':
    'استخدمه لتسلسلات متكررة عبر عدة تبويبات: مقارنة الصفحات، وجمع التفاصيل، وإعادة ملخص واضح.',
  'home.privacy.h2': 'بياناتك تبقى ملكك.',
  'home.privacy.body':
    'استخدم مفتاحك الخاص إذا أردت تحليلًا خارجيًا. تمر الطلبات مباشرة عبر حساب مزود الذكاء الاصطناعي الذي أعددته، من جهازك. يبقى السجل والمحادثات على جهازك. بلا تتبع.',
  'features.h1': 'وكيل يُشغّل المتصفح، لتوفّر على نفسك العناء.',
  'features.sub': 'يجمع بين متصفح حقيقي متكامل ووكيل مدعوم من BulleBrowser. يتصفح الويب كما يفعل الإنسان: يقرأ، وينقر، ويكتب، ويستخرج، كل ذلك ضمن حلقة حتمية يمكن إيقافها وتثق بها.',
  'features.cap.eyebrow': 'القدرات',
  'features.cap.title': 'يعمل على الويب الحيّ، لا على فهرس قديم.',
  'features.cap.body': 'يعمل الوكيل على التبويب النشط، بالصفحات نفسها وتسجيلات الدخول والبيانات التي تراها، من خلال مجموعة إجراءات مركّزة:',
  'features.tool.navigate.t': 'التنقّل',
  'features.tool.navigate.d': 'فتح أي رابط في تبويب نشط.',
  'features.tool.read.t': 'القراءة',
  'features.tool.read.d': 'استخراج نص نظيف وقابل للقراءة من الصفحة.',
  'features.tool.click.t': 'النقر والكتابة',
  'features.tool.click.d': 'تشغيل النماذج وعناصر التحكم بالاسم أو المحدِّد.',
  'features.tool.extract.t': 'الاستخراج',
  'features.tool.extract.d': 'استخراج بيانات منظّمة وفق مخطط تحدده أنت.',
  'features.tool.tabs.t': 'إدارة التبويبات',
  'features.tool.tabs.d': 'فتح التبويبات والتبديل بينها والتنسيق عبرها.',
  'features.tool.wait.t': 'الانتظار',
  'features.tool.wait.d': 'التوقّف حتى يستقر عنصر أو تستقر الشبكة.',
  'features.skills.eyebrow': 'المهارات',
  'features.skills.title': 'ثلاث مهارات رئيسية، ووكيل عام لِما تبقّى.',
  'features.skills.foot': 'هذه الثلاث تتصدّر العمل، إلى جانب مهام كثيرة أخرى ينفّذها الوكيل. اختر إعدادًا مسبقًا لسير عمل موجَّه، أو صِف حاجتك بلغة بسيطة.',
  'features.ctrl.eyebrow': 'التحكّم والثقة',
  'features.ctrl.title': 'قويّ، لكنه لا يعمل تلقائيًا أبدًا.',
  'features.ctrl.control.t': 'تبقى المتحكّم',
  'features.ctrl.control.d': 'مؤشّر مباشر يُظهر كل خطوة، وزرّ إيقاف يُلغي فورًا.',
  'features.ctrl.runaway.t': 'لا انفلات',
  'features.ctrl.runaway.d': 'لكل مهمة ميزانية خطوات: تنبيه عند 75٪ وتوقف عند الحد، ويمكنك رفعها لكل مهمة.',
  'features.ctrl.ask.t': 'يسأل قبل التنفيذ',
  'features.ctrl.ask.d': 'إرسال النماذج والتنزيلات يتطلّب تأكيدك الصريح.',
  'features.ctrl.model.t': 'نموذجك',
  'features.ctrl.model.d': 'اختر Pro أو Balanced أو Fastest لكل مهمة.',
  'features.priv.eyebrow': 'الخصوصية',
  'features.priv.title': 'استخدم مفتاحك الخاص. واحتفظ ببياناتك.',
  'features.priv.1': 'تمرّ طلباتك مباشرة عبر مزوّدك المُعدّ، من جهازك.',
  'features.priv.2': 'مفتاح الواجهة البرمجية مشفّر في سلسلة مفاتيح نظام تشغيلك.',
  'features.priv.3': 'يبقى السجل والإشارات المرجعية والمحادثات على جهازك.',
  'features.priv.4': 'لا تحليلات. لا تتبّع.',
  'features.cta.h2': 'ضَع الوكيل في العمل.',
  'features.cta.sub': 'متوفّر على macOS و Windows و Linux.',
  'download.badge': 'تنزيلات رسمية',
  'download.h1': 'تنزيل',
  'download.sub': 'كل مُثبِّت هنا مرتبط بقناة الإصدار الحالية ويتضمّن تجربة المتصفح الوكيل المدمجة.',
  'download.signed': 'الإصدارات موقّعة وموثّقة على macOS و Windows.',
};

const es419: Dict = {
  'nav.home': 'Inicio',
  'nav.workflows': 'Flujos de trabajo',
  'nav.guides': 'Guías',
  'nav.download': 'Descargar',
  'nav.translation': 'Traducción',
  'nav.chooseLanguage': 'Elegir un idioma',
  'footer.rights': 'Todos los derechos reservados.',
  'footer.tagline': 'El navegador que navega por ti',
  'home.badge': 'IA con agentes · Por',
  'home.h1': 'El navegador que navega por ti.',
  'home.sub':
    'Un agente de IA que lee páginas, completa tareas del navegador y hace todo lo demás que le pidas, directamente en tu navegador.',
  'film.title': 'Míralo en acción.',
  'film.play': 'Reproducir el video de BulleBrowser',
  'film.pause': 'Pausar el video',
  'film.fallback': 'No se pudo cargar el video. Intenta actualizar la página.',
  'film.demo': 'Prueba el asistente',
  'film.description': 'Una persona le pide a BulleBrowser que encuentre subvenciones para un proyecto de empoderamiento comunitario en Nueva Jersey y Los Ángeles. El asistente abre Grants.gov, busca, lee los resultados, abre las tres mejores oportunidades en pestañas nuevas y entrega una comparación con fuentes, mientras la persona mantiene el control y sus datos se quedan en su dispositivo.',
  'home.skills.eyebrow': 'Habilidades del agente',
  'home.skills.h2': 'Inteligencia nativa, integrada en el navegador.',
  'home.skills.body':
    'No es un chatbot añadido a una barra lateral. Está diseñado para la automatización general del navegador. Tres habilidades principales marcan el camino, y el agente asume mucho más cuando se lo pides.',
  'home.skills.explore': 'Explorar las funciones',
  'skill.page.title': 'Asistente de página',
  'skill.page.lede': 'Leer y resumir lo que está en pantalla.',
  'skill.page.body':
    'Pídele que lea una página, extraiga los puntos importantes y te dé una respuesta concisa con sus fuentes.',
  'skill.nav.title': 'Navegador de sitios',
  'skill.nav.lede': 'Realizar una tarea dentro de un sitio activo.',
  'skill.nav.body':
    'Dile a dónde ir y qué hacer. Abre la página, encuentra el control y completa la acción.',
  'skill.flow.title': 'Automatizador de flujos',
  'skill.flow.lede': 'Coordinar tareas de varios pasos.',
  'skill.flow.body':
    'Úsalo para secuencias repetibles entre pestañas: comparar páginas, reunir detalles y devolver un resumen claro.',
  'home.privacy.h2': 'Tus datos siguen siendo tuyos.',
  'home.privacy.body':
    'Usa tu propia clave si quieres síntesis externa. Las solicitudes pasan directamente por la cuenta del proveedor de IA que configuraste, desde tu dispositivo. El historial y las conversaciones permanecen en tu dispositivo. Sin telemetría.',
  'features.h1': 'Un agente que opera el navegador, para que tú no tengas que hacerlo.',
  'features.sub': 'Combina un navegador real y completo con un agente impulsado por BulleBrowser. Recorre la web como lo haría una persona: leer, hacer clic, escribir y extraer, todo en un ciclo determinista y detenible en el que puedes confiar.',
  'features.cap.eyebrow': 'Capacidades',
  'features.cap.title': 'Trabaja con la web en vivo, no con un índice desactualizado.',
  'features.cap.body': 'El agente actúa sobre la pestaña activa, con las mismas páginas, los mismos inicios de sesión y los mismos datos que verías, mediante un conjunto de acciones específicas:',
  'features.tool.navigate.t': 'Navegar',
  'features.tool.navigate.d': 'Abrir cualquier URL en una pestaña activa.',
  'features.tool.read.t': 'Leer',
  'features.tool.read.d': 'Extraer texto limpio y legible de la página.',
  'features.tool.click.t': 'Hacer clic y escribir',
  'features.tool.click.d': 'Operar formularios y controles por etiqueta o selector.',
  'features.tool.extract.t': 'Extraer',
  'features.tool.extract.d': 'Obtener datos estructurados según un esquema que tú defines.',
  'features.tool.tabs.t': 'Gestionar pestañas',
  'features.tool.tabs.d': 'Abrir, cambiar y coordinar varias pestañas.',
  'features.tool.wait.t': 'Esperar',
  'features.tool.wait.d': 'Pausar hasta que un elemento o la red se estabilicen.',
  'features.skills.eyebrow': 'Habilidades',
  'features.skills.title': 'Tres habilidades principales, y un agente general para lo demás.',
  'features.skills.foot': 'Estas tres marcan el camino, entre muchas otras tareas que el agente asume. Elige un ajuste para un flujo guiado, o describe lo que necesitas en lenguaje sencillo.',
  'features.ctrl.eyebrow': 'Control y confianza',
  'features.ctrl.title': 'Potente, pero nunca en piloto automático.',
  'features.ctrl.control.t': 'Tú mantienes el control',
  'features.ctrl.control.d': 'Un indicador en vivo muestra cada paso, y un botón Detener cancela al instante.',
  'features.ctrl.runaway.t': 'Sin descontrol',
  'features.ctrl.runaway.d': 'Cada tarea tiene un presupuesto de pasos: avisa al 75 %, se detiene en el límite y puedes ampliarlo por tarea.',
  'features.ctrl.ask.t': 'Preguntar antes de actuar',
  'features.ctrl.ask.d': 'El envío de formularios y las descargas requieren tu confirmación explícita.',
  'features.ctrl.model.t': 'Tu modelo',
  'features.ctrl.model.d': 'Elige Pro, Balanced o Fastest según la tarea.',
  'features.priv.eyebrow': 'Privacidad',
  'features.priv.title': 'Usa tu propia clave. Conserva tus propios datos.',
  'features.priv.1': 'Tus solicitudes pasan directamente por el proveedor que configuraste, desde tu dispositivo.',
  'features.priv.2': 'Tu clave de API se cifra en el llavero de tu sistema operativo.',
  'features.priv.3': 'El historial, los marcadores y las conversaciones permanecen en tu dispositivo.',
  'features.priv.4': 'Sin analíticas. Sin telemetría.',
  'features.cta.h2': 'Pon el agente a trabajar.',
  'features.cta.sub': 'Disponible para macOS, Windows y Linux.',
  'download.badge': 'Descargas oficiales',
  'download.h1': 'Descargar',
  'download.sub': 'Cada instalador aquí está vinculado al canal de versión actual e incluye la experiencia de navegador con agente integrada.',
  'download.signed': 'Las versiones están firmadas y notarizadas en macOS y Windows.',
};

const ptPT: Dict = {
  'nav.home': 'Início',
  'nav.workflows': 'Fluxos de trabalho',
  'nav.guides': 'Guias',
  'nav.download': 'Transferir',
  'nav.translation': 'Tradução',
  'nav.chooseLanguage': 'Escolher um idioma',
  'footer.rights': 'Todos os direitos reservados.',
  'footer.tagline': 'O navegador que navega por si',
  'home.badge': 'IA com agentes · Por',
  'home.h1': 'O navegador que navega por si.',
  'home.sub':
    'Um agente de IA que lê páginas, executa tarefas no navegador e faz tudo o que lhe pedir, diretamente no seu navegador.',
  'film.title': 'Veja-o a trabalhar.',
  'film.play': 'Reproduzir o filme BulleBrowser',
  'film.pause': 'Pausar o filme',
  'film.fallback': 'Não foi possível carregar o filme. Tente atualizar a página.',
  'film.demo': 'Experimente o assistente',
  'film.description': 'Uma pessoa pede ao BulleBrowser que encontre apoios para um projeto de capacitação comunitária em Nova Jérsia e Los Angeles. O assistente abre o Grants.gov, pesquisa, lê os resultados, abre as três melhores oportunidades em novos separadores e devolve uma comparação com fontes, enquanto a pessoa mantém o controlo e os seus dados ficam no seu dispositivo.',
  'home.skills.eyebrow': 'Competências do agente',
  'home.skills.h2': 'Inteligência nativa, integrada no navegador.',
  'home.skills.body':
    'Não é um chatbot acrescentado a uma barra lateral. Foi concebido para a automatização geral do navegador. Três competências principais abrem caminho, e o agente assume muito mais quando lhe for pedido.',
  'home.skills.explore': 'Explorar as funcionalidades',
  'skill.page.title': 'Assistente de página',
  'skill.page.lede': 'Ler e resumir o que está no ecrã.',
  'skill.page.body':
    'Peça-lhe que leia uma página, retire os pontos essenciais e lhe dê uma resposta concisa com as fontes.',
  'skill.nav.title': 'Navegador de sites',
  'skill.nav.lede': 'Executar uma tarefa num site ativo.',
  'skill.nav.body':
    'Diga-lhe para onde ir e o que fazer. Abre a página, encontra o controlo e conclui a ação.',
  'skill.flow.title': 'Automatização de fluxos',
  'skill.flow.lede': 'Coordenar tarefas de vários passos.',
  'skill.flow.body':
    'Utilize-o para sequências repetíveis entre separadores: comparar páginas, reunir detalhes e devolver um resumo claro.',
  'home.privacy.h2': 'Os seus dados continuam seus.',
  'home.privacy.body':
    'Use a sua própria chave se quiser síntese externa. Os pedidos passam diretamente pela conta do fornecedor de IA que configurou, a partir do seu dispositivo. O histórico e as conversas permanecem no seu dispositivo. Sem telemetria.',
  'features.h1': 'Um agente que opera o navegador, para que não tenha de o fazer.',
  'features.sub': 'Combina um navegador real e completo com um agente com tecnologia BulleBrowser. Navega na web como uma pessoa faria: ler, clicar, escrever e extrair, tudo num ciclo determinista e interrompível em que pode confiar.',
  'features.cap.eyebrow': 'Capacidades',
  'features.cap.title': 'Trabalha com a web ao vivo, não com um índice desatualizado.',
  'features.cap.body': 'O agente atua no separador ativo, com as mesmas páginas, as mesmas sessões e os mesmos dados que veria, através de um conjunto de ações focadas:',
  'features.tool.navigate.t': 'Navegar',
  'features.tool.navigate.d': 'Abrir qualquer URL num separador ativo.',
  'features.tool.read.t': 'Ler',
  'features.tool.read.d': 'Extrair texto limpo e legível da página.',
  'features.tool.click.t': 'Clicar e escrever',
  'features.tool.click.d': 'Operar formulários e controlos por etiqueta ou seletor.',
  'features.tool.extract.t': 'Extrair',
  'features.tool.extract.d': 'Obter dados estruturados segundo um esquema que define.',
  'features.tool.tabs.t': 'Gerir separadores',
  'features.tool.tabs.d': 'Abrir, alternar e coordenar vários separadores.',
  'features.tool.wait.t': 'Aguardar',
  'features.tool.wait.d': 'Pausar até que um elemento ou a rede estabilizem.',
  'features.skills.eyebrow': 'Competências',
  'features.skills.title': 'Três competências principais, e um agente geral para o resto.',
  'features.skills.foot': 'Estas três abrem caminho, entre muitas outras tarefas que o agente assume. Escolha uma predefinição para um fluxo guiado, ou descreva o que precisa em linguagem simples.',
  'features.ctrl.eyebrow': 'Controlo e confiança',
  'features.ctrl.title': 'Poderoso, mas nunca em piloto automático.',
  'features.ctrl.control.t': 'Mantém o controlo',
  'features.ctrl.control.d': 'Um indicador ao vivo mostra cada passo, e um botão Parar cancela de imediato.',
  'features.ctrl.runaway.t': 'Sem descontrolos',
  'features.ctrl.runaway.d': 'Cada tarefa tem um orçamento de passos: avisa aos 75 %, para no limite e pode aumentá-lo por tarefa.',
  'features.ctrl.ask.t': 'Perguntar antes de agir',
  'features.ctrl.ask.d': 'O envio de formulários e as transferências exigem a sua confirmação explícita.',
  'features.ctrl.model.t': 'O seu modelo',
  'features.ctrl.model.d': 'Escolha Pro, Balanced ou Fastest por tarefa.',
  'features.priv.eyebrow': 'Privacidade',
  'features.priv.title': 'Use a sua própria chave. Mantenha os seus próprios dados.',
  'features.priv.1': 'Os seus pedidos passam diretamente pelo fornecedor que configurou, a partir do seu dispositivo.',
  'features.priv.2': 'A sua chave de API é cifrada no porta-chaves do seu sistema operativo.',
  'features.priv.3': 'Histórico, marcadores e conversas permanecem no seu dispositivo.',
  'features.priv.4': 'Sem análises. Sem telemetria.',
  'features.cta.h2': 'Ponha o agente a trabalhar.',
  'features.cta.sub': 'Disponível para macOS, Windows e Linux.',
  'download.badge': 'Transferências oficiais',
  'download.h1': 'Transferir',
  'download.sub': 'Cada instalador aqui está associado ao canal de versão atual e inclui a experiência de navegador com agente integrada.',
  'download.signed': 'As versões são assinadas e notarizadas em macOS e Windows.',
};

const DICTS: Record<Locale, Dict> = { en, fr, ar, 'es-419': es419, 'pt-PT': ptPT };

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: 'en',
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved && (LOCALES as readonly string[]).includes(saved)) setLocaleState(saved);
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<Locale>).detail;
      if (next) setLocaleState(next);
    };
    window.addEventListener('bullebrowser:locale', onChange);
    return () => window.removeEventListener('bullebrowser:locale', onChange);
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    window.localStorage.setItem(STORAGE_KEY, l);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

/** Translate a key, falling back to English then to the key itself. */
export function useT() {
  const { locale } = useLocale();
  return (key: string): string => DICTS[locale]?.[key] ?? en[key] ?? key;
}
