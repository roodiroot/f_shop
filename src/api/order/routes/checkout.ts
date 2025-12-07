export default {
  routes: [
    {
      method: "POST",
      path: "/orders/checkout",
      handler: "checkout.checkout",
    },
    {
      method: "POST",
      path: "/payments/webhook",
      handler: "checkout.webhook",
      config: {
        auth: false,
      },
    },
  ],
};
