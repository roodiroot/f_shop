export default {
  routes: [
    {
      method: "GET",
      path: "/filters/:categoryId",
      handler: "filters.getFilters",
      config: {
        auth: false,
      },
    },
  ],
};
