const transformDocument = (_, ret) => {
  if (ret._id) {
    ret.id = ret._id.toString();
    delete ret._id;
  }

  return ret;
};

export const baseSchemaOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: transformDocument,
  },
  toObject: {
    virtuals: true,
    versionKey: false,
    transform: transformDocument,
  },
};
