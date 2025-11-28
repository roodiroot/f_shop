export default ({ env }) => ({
  graphql: {
    config: {
      landingPage: true, // Включает Sandbox в продакшне (НЕ рекомендуется)
    },
  },
  email: {
    config: {
      provider: "nodemailer",
      providerOptions: {
        host: env("BEGET_EMAIL_HOST"),
        port: env("BEGET_EMAIL_PORT"),
        auth: {
          user: env("BEGET_EMAIL_USER"),
          pass: env("BEGET_EMAIL_PASS"),
        },
      },
      settings: {
        defaultFrom: env("BEGET_EMAIL_USER"),
        defaultReplyTo: env("BEGET_EMAIL_USER"),
      },
    },
  },
});
