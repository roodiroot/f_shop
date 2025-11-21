export default {
  async getFilters(ctx) {
    try {
      const id = ctx.params.categoryId;

      const rootCategory = await strapi
        .documents("api::category.category")
        .findOne({
          documentId: id,
          populate: ["children"],
        });

      const categoryIds = collectCategoryIds(rootCategory);

      const knex = strapi.db.connection;

      const filters = {
        gender: await distinct(knex, "gender", categoryIds),
        color: await distinct(knex, "color", categoryIds),
        topBottom: await distinct(knex, "top_bottom", categoryIds),
        rise: await distinct(knex, "rise", categoryIds),
        season: await distinct(knex, "season", categoryIds),
        seasonality: await distinct(knex, "seasonality", categoryIds),
        composition: await distinct(knex, "composition", categoryIds),
        denomination: await distinct(knex, "denomination", categoryIds),
        categoryParam: await distinct(knex, "category_param", categoryIds),
        minPrice: await min(knex, "price", categoryIds),
        maxPrice: await max(knex, "price", categoryIds),
      };

      ctx.body = { filters };
    } catch (error) {
      console.error(error);
      ctx.internalServerError("Error while loading filters");
    }
  },
};

function collectCategoryIds(cat) {
  const ids = [cat.id];

  if (cat.children && cat.children.length) {
    for (const child of cat.children) {
      ids.push(...collectCategoryIds(child));
    }
  }

  return ids;
}

async function distinct(knex, field, categoryIds) {
  const rows = await knex("products as p")
    .distinct(`p.${field}`)
    .join("categories_products_lnk as cpl", "cpl.product_id", "p.id")
    .whereIn("cpl.category_id", categoryIds)
    .whereNotNull(`p.${field}`);

  return rows.map((r) => r[field]);
}

async function min(knex, field, categoryIds) {
  const row = await knex("products as p")
    .min(`p.${field} as value`) // агрегат min
    .join("categories_products_lnk as cpl", "cpl.product_id", "p.id")
    .whereIn("cpl.category_id", categoryIds)
    .first();

  return row?.value ? Number(row.value) : null;
}

async function max(knex, field, categoryIds) {
  const row = await knex("products as p")
    .max(`p.${field} as value`)
    .join("categories_products_lnk as cpl", "cpl.product_id", "p.id")
    .whereIn("cpl.category_id", categoryIds)
    .first();

  return row?.value ? Number(row.value) : null;
}
