import { Router, type IRouter } from "express";
import healthRouter from "./health";
import correctRouter from "./correct";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(correctRouter);

export default router;
