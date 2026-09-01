using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeExcursion.Api.Migrations.Home
{
    /// <inheritdoc />
    public partial class AddTaskArea : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Area",
                schema: "home",
                table: "Tasks",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tasks_PropertyId_Area",
                schema: "home",
                table: "Tasks",
                columns: new[] { "PropertyId", "Area" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Tasks_PropertyId_Area",
                schema: "home",
                table: "Tasks");

            migrationBuilder.DropColumn(
                name: "Area",
                schema: "home",
                table: "Tasks");
        }
    }
}
