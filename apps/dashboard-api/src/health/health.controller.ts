import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator.js";

/**
 * 🔴 هذه النقطة ممنوع تلمس قاعدة البيانات.
 *
 * فايدتها الوحيدة إنك لما إشي يقع تعرف: ردّت؟ التطبيق عايش والمشكلة بالقاعدة.
 * ما ردّت؟ التطبيق نفسه ميت. لو ربطناها بالقاعدة، بتوقع معها وبتفقد معناها.
 */
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  check(): { ok: true } {
    return { ok: true };
  }
}
