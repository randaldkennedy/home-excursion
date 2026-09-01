using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class AddPurchasesAndAllocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Purchases",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    VendorId = table.Column<int>(type: "int", nullable: true),
                    LegacyExpenseId = table.Column<int>(type: "int", nullable: true),
                    Vendor = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    PurchaseDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Subtotal = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: true),
                    Tax = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: true),
                    Total = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Source = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    VerifiedAt = table.Column<DateTime>(type: "datetime2", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Purchases", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Purchases_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalSchema: "home",
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Purchases_Vendors_VendorId",
                        column: x => x.VendorId,
                        principalSchema: "home",
                        principalTable: "Vendors",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "PurchaseAllocations",
                schema: "home",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PurchaseId = table.Column<int>(type: "int", nullable: false),
                    ProjectId = table.Column<int>(type: "int", nullable: true),
                    TaskId = table.Column<int>(type: "int", nullable: true),
                    LegacyExpenseId = table.Column<int>(type: "int", nullable: true),
                    Amount = table.Column<decimal>(type: "decimal(12,2)", precision: 12, scale: 2, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Category = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: true),
                    AllocationType = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    IsIncludedInHomeSpend = table.Column<bool>(type: "bit", nullable: false),
                    SuggestedBy = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    Confidence = table.Column<decimal>(type: "decimal(5,4)", precision: 5, scale: 4, nullable: true),
                    IsVerified = table.Column<bool>(type: "bit", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseAllocations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseAllocations_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalSchema: "home",
                        principalTable: "Projects",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_PurchaseAllocations_Purchases_PurchaseId",
                        column: x => x.PurchaseId,
                        principalSchema: "home",
                        principalTable: "Purchases",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PurchaseAllocations_Tasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "home",
                        principalTable: "Tasks",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseAllocations_LegacyExpenseId",
                schema: "home",
                table: "PurchaseAllocations",
                column: "LegacyExpenseId",
                unique: true,
                filter: "[LegacyExpenseId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseAllocations_ProjectId",
                schema: "home",
                table: "PurchaseAllocations",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseAllocations_PurchaseId",
                schema: "home",
                table: "PurchaseAllocations",
                column: "PurchaseId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseAllocations_TaskId",
                schema: "home",
                table: "PurchaseAllocations",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_LegacyExpenseId",
                schema: "home",
                table: "Purchases",
                column: "LegacyExpenseId",
                unique: true,
                filter: "[LegacyExpenseId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_PropertyId_PurchaseDate",
                schema: "home",
                table: "Purchases",
                columns: new[] { "PropertyId", "PurchaseDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_PropertyId_Status",
                schema: "home",
                table: "Purchases",
                columns: new[] { "PropertyId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Purchases_VendorId",
                schema: "home",
                table: "Purchases",
                column: "VendorId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PurchaseAllocations",
                schema: "home");

            migrationBuilder.DropTable(
                name: "Purchases",
                schema: "home");
        }
    }
}
