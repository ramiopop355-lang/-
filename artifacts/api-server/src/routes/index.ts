import { Router, type IRouter } from "express";
import healthRouter from "./health";
import correctRouter from "./correct";
import authRouter from "./auth";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(correctRouter);
router.use(pushRouter);

export default router;
