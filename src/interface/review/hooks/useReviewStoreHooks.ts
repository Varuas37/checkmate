import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";

import type { ReviewDispatch, ReviewRootState } from "../../../app/store/review/index.ts";

export const useReviewDispatch = () => useDispatch<ReviewDispatch>();
export const useReviewSelector: TypedUseSelectorHook<ReviewRootState> = useSelector;
