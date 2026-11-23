import { AppError } from '../utils/AppError.js';

function run(schema, source) {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      return next(new AppError(400, details[0]?.message ?? 'Invalid request', details));
    }
    req[source] = result.data;
    next();
  };
}

export const validate = (schema) => run(schema, 'body');
export const validateQuery = (schema) => run(schema, 'query');
